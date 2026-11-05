#!/usr/bin/env node
/*
 * XI · La Justicia — revisa lo que vas a subir a git y te propone el mensaje del commit.
 *
 *   node justicia.js revisar                 avisos sobre lo que está en staging (nunca bloquea)
 *   node justicia.js sugerir [--copiar]      mensaje sugerido (con Gemini si hay clave)
 *   node justicia.js gancho-mensaje <archivo> [origen]   lo usa el gancho prepare-commit-msg
 *   node justicia.js instalar [--global]     instala los ganchos en este repositorio (o en todos)
 *   node justicia.js desinstalar [--global]
 *   node justicia.js configurar <clave> [modelo]   guarda la clave de Gemini
 *
 * Lo usa también la extensión de VS Code / Kiro (require("./justicia.js")).
 * Sin dependencias: solo Node 18+ y git.
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MODELO_POR_DEFECTO = "gemini-3.5-flash-lite";
const MAX_DIFF = 30000; // caracteres de diff que se envían a Gemini

// ---------------------------------------------------------------- git

let binarioGit = "git";
/** La extensión de VS Code usa el git que ya encontró el editor. */
function usarGit(ruta) { if (ruta) binarioGit = ruta; }

function git(args, cwd, opciones) {
  return execFileSync(binarioGit, args, Object.assign({ cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }, opciones || {}));
}

function raizRepo(cwd) {
  return git(["rev-parse", "--show-toplevel"], cwd).trim();
}

/** Archivos en staging con su estado (A, M, D, R…) y las líneas agregadas de cada uno. */
function cambiosEnStaging(cwd) {
  const estados = git(["diff", "--cached", "--name-status", "-M", "-z"], cwd).split("\0").filter(Boolean);
  const archivos = [];
  for (let i = 0; i < estados.length; i++) {
    const estado = estados[i];
    if (estado[0] === "R" || estado[0] === "C") {
      archivos.push({ estado: estado[0], anterior: estados[i + 1], ruta: estados[i + 2], agregadas: [], binario: false });
      i += 2;
    } else {
      archivos.push({ estado: estado[0], ruta: estados[i + 1], agregadas: [], binario: false });
      i += 1;
    }
  }
  if (archivos.length === 0) return { archivos, diff: "" };

  const diff = git(["diff", "--cached", "-M", "--no-color", "--no-ext-diff", "-U2"], cwd);
  let actual = null, linea = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) { actual = null; continue; }
    if (l.startsWith("+++ ")) {
      const ruta = l.slice(4).replace(/^b\//, "").replace(/\t.*$/, "");
      actual = archivos.find((a) => a.ruta === ruta) || null;
      continue;
    }
    if (l.startsWith("Binary files ")) {
      const m = / and b\/(.+) differ$/.exec(l) || / and (.+) differ$/.exec(l);
      const a = m && archivos.find((x) => x.ruta === m[1]);
      if (a) a.binario = true;
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { linea = parseInt(h[1], 10); continue; }
    if (!actual) continue;
    if (l.startsWith("+")) { actual.agregadas.push({ n: linea, texto: l.slice(1) }); linea++; }
    else if (l.startsWith(" ")) linea++;
  }
  for (const a of archivos) {
    if (a.estado === "D") continue;
    try { a.tamano = parseInt(git(["cat-file", "-s", ":" + a.ruta], cwd).trim(), 10); } catch (e) { a.tamano = 0; }
  }
  return { archivos, diff };
}

// ---------------------------------------------------------------- reglas

const SECRETOS = [
  { re: /AKIA[0-9A-Z]{16}/, que: "una clave de AWS" },
  { re: /AIza[0-9A-Za-z_\-]{35}/, que: "una clave de API de Google (Gemini, Maps, Firebase…)" },
  { re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b|github_pat_[0-9A-Za-z_]{40,}/, que: "un token de GitHub" },
  { re: /sk-ant-[0-9A-Za-z_\-]{20,}/, que: "una clave de API de Anthropic" },
  { re: /\bsk-(?:proj-)?[0-9A-Za-z_\-]{32,}/, que: "una clave de API de OpenAI" },
  { re: /xox[baprs]-[0-9A-Za-z-]{10,}/, que: "un token de Slack" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, que: "una clave privada" },
  { re: /(?:password|pwd)=[^;"'\s]{3,}\s*;/i, que: "una contraseña dentro de una cadena de conexión" },
  { re: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i, que: "una contraseña o clave escrita en el código" },
];

const DEPURACION = [
  { re: /\bconsole\.(?:log|debug)\s*\(/, ext: /\.(?:[cm]?jsx?|tsx?|vue|svelte)$/, que: "console.log" },
  { re: /^\s*debugger\s*;?\s*$/, ext: /\.(?:[cm]?jsx?|tsx?|vue|svelte)$/, que: "debugger" },
  { re: /^\s*print\s*\(/, ext: /\.py$/, que: "print(" },
  { re: /\bbreakpoint\s*\(\s*\)/, ext: /\.py$/, que: "breakpoint()" },
  { re: /\bSystem\.out\.println\s*\(/, ext: /\.(?:java|kt)$/, que: "System.out.println" },
  { re: /\bLog\.[dv]\s*\(/, ext: /\.(?:java|kt)$/, que: "Log.d / Log.v" },
  { re: /^\s*println\s*\(/, ext: /\.kt$/, que: "println(" },
  { re: /\bDebug\.WriteLine\s*\(/, ext: /\.cs$/, que: "Debug.WriteLine" },
  { re: /\b(?:var_dump|print_r)\s*\(/, ext: /\.php$/, que: "var_dump / print_r" },
];

const SENSIBLES = [
  { re: /(^|\/)\.env(\.[^/]*)?$/, excepto: /\.(example|sample|template)$/, que: "un archivo .env (suele tener claves)" },
  { re: /(^|\/)(credentials|token|client_secret[^/]*)\.json$/i, que: "un archivo de credenciales" },
  { re: /(^|\/)(id_rsa|id_ed25519)(\.pub)?$|\.(pem|p12|pfx|key)$/i, que: "una llave o certificado" },
  { re: /\.(keystore|jks)$/i, que: "un almacén de llaves de Android (firma de la app)" },
  { re: /(^|\/)local\.properties$/, que: "local.properties (rutas de tu PC, no se sube)" },
];

const CARPETAS_GENERADAS = /(^|\/)(node_modules|build|bin|obj|dist|out|\.gradle|\.idea|\.vs|__pycache__|\.venv|venv|target)\//;
const BINARIOS = /\.(apk|aab|exe|dll|pdb|so|zip|7z|rar|class|pyc|o|obj)$/i;
const PERMITIDOS = /(^|\/)gradle-wrapper\.jar$/;
const LIMITE_GRANDE = 5 * 1024 * 1024;

/**
 * Revisa los cambios y devuelve avisos: { gravedad: "alta"|"media"|"info", archivo, linea?, regla, mensaje, consejo }.
 * Nunca lanza ni bloquea: solo informa.
 */
function revisar(cambios) {
  const avisos = [];
  const agregar = (gravedad, archivo, linea, regla, mensaje, consejo) => avisos.push({ gravedad, archivo, linea, regla, mensaje, consejo });

  for (const a of cambios.archivos) {
    if (a.estado === "D") continue;
    const r = a.ruta;

    for (const s of SENSIBLES) {
      if (s.re.test(r) && !(s.excepto && s.excepto.test(r))) {
        agregar("alta", r, null, "archivo-sensible", "Vas a subir " + s.que + ".", "Sácalo del commit (git restore --staged " + r + ") y agrégalo a .gitignore.");
      }
    }
    if (CARPETAS_GENERADAS.test(r)) {
      agregar("media", r, null, "carpeta-generada", "Este archivo está en una carpeta que genera el compilador o el gestor de paquetes.", "No se sube: agrega la carpeta a .gitignore.");
    } else if (BINARIOS.test(r) && !PERMITIDOS.test(r)) {
      agregar("media", r, null, "binario", "Vas a subir un archivo compilado o comprimido.", "Normalmente se sube el código, no el resultado; si es a propósito, puedes ignorar este aviso.");
    }
    if (a.tamano > LIMITE_GRANDE) {
      agregar("media", r, null, "grande", "El archivo pesa " + (a.tamano / 1048576).toFixed(1) + " MB.", "Los repositorios crecen para siempre con cada versión de un archivo grande; considera dejarlo fuera o usar Git LFS.");
    }

    let todos = 0;
    for (const l of a.agregadas) {
      const t = l.texto;
      if (/^(<{7}|={7}|>{7})( |$)/.test(t)) {
        agregar("alta", r, l.n, "conflicto", "Quedó una marca de conflicto de git (" + t.slice(0, 7) + ").", "Resuelve el conflicto y borra las marcas <<<<<<<, ======= y >>>>>>>.");
      }
      for (const s of SECRETOS) {
        if (s.re.test(t)) {
          agregar("alta", r, l.n, "secreto", "Parece " + s.que + ".", "Muévela a una variable de entorno o a un archivo ignorado (.env) y cámbiala si ya se subió alguna vez.");
          break;
        }
      }
      for (const d of DEPURACION) {
        if (d.ext.test(r) && d.re.test(t)) {
          agregar("info", r, l.n, "depuracion", "Quedó un " + d.que + " de depuración.", "Si era para probar, bórralo antes del commit.");
          break;
        }
      }
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(t)) todos++;
    }
    if (todos > 0) agregar("info", r, null, "pendientes", todos + (todos === 1 ? " TODO/FIXME nuevo." : " TODO/FIXME nuevos."), "Está bien dejarlos, solo para que lo tengas presente.");
  }
  const orden = { alta: 0, media: 1, info: 2 };
  return avisos.sort((x, y) => orden[x.gravedad] - orden[y.gravedad]);
}

/** Tapa los secretos antes de mandar el diff a Gemini. */
function ocultarSecretos(texto) {
  let t = texto;
  for (const s of SECRETOS) t = t.replace(new RegExp(s.re.source, s.re.flags.includes("i") ? "gi" : "g"), "«oculto»");
  return t;
}

// ---------------------------------------------------------------- mensaje

/** Mensaje por reglas (sin IA): tipo(alcance): descripción. */
function mensajePorReglas(cambios) {
  const arch = cambios.archivos;
  if (arch.length === 0) return "";
  const rutas = arch.map((a) => a.ruta);
  const soloDocs = rutas.every((r) => /\.(md|txt|rst)$/i.test(r) || /(^|\/)docs?\//i.test(r));
  const soloPruebas = rutas.every((r) => /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.\w+$|Tests?\.\w+$/.test(r));
  const soloConfig = rutas.every((r) => /(^|\/)(\.github|\.vscode)\/|\.(json|ya?ml|toml|properties|gradle|kts|gitignore|gitattributes|editorconfig)$/i.test(r));
  const nuevos = arch.filter((a) => a.estado === "A").length;
  const borrados = arch.filter((a) => a.estado === "D").length;
  let tipo = "chore";
  if (soloDocs) tipo = "docs";
  else if (soloPruebas) tipo = "test";
  else if (soloConfig) tipo = "build";
  else if (nuevos > 0 && nuevos >= arch.length / 2) tipo = "feat";
  else if (arch.every((a) => a.estado === "R")) tipo = "refactor";

  const carpetas = new Set(rutas.map((r) => r.includes("/") ? r.split("/")[0] : ""));
  const alcance = carpetas.size === 1 && [...carpetas][0] ? "(" + [...carpetas][0] + ")" : "";
  let que;
  if (arch.length === 1) {
    const a = arch[0], nombre = path.basename(a.ruta);
    que = (a.estado === "A" ? "agrega " : a.estado === "D" ? "elimina " : a.estado === "R" ? "renombra " : "actualiza ") + nombre;
  } else {
    const partes = [];
    if (nuevos) partes.push("agrega " + nuevos + " archivo" + (nuevos > 1 ? "s" : ""));
    const mod = arch.length - nuevos - borrados;
    if (mod) partes.push("actualiza " + mod);
    if (borrados) partes.push("elimina " + borrados);
    que = partes.join(", ");
  }
  return tipo + alcance + ": " + que;
}

function leerConfig() {
  const ruta = rutaConfig();
  let c = {};
  try { c = JSON.parse(fs.readFileSync(ruta, "utf8")); } catch (e) { /* sin archivo */ }
  return {
    clave: process.env.GEMINI_API_KEY || c.clave || "",
    modelo: process.env.JUSTICIA_MODELO || c.modelo || MODELO_POR_DEFECTO,
  };
}

function rutaConfig() {
  const base = process.env.APPDATA || path.join(os.homedir(), ".config");
  return path.join(base, "Justicia", "config.json");
}

function guardarConfig(clave, modelo) {
  const ruta = rutaConfig();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify({ clave, modelo: modelo || MODELO_POR_DEFECTO }, null, 2));
  return ruta;
}

function instrucciones(cambios, idioma) {
  const lista = cambios.archivos.map((a) => a.estado + " " + (a.anterior ? a.anterior + " → " : "") + a.ruta).join("\n");
  let diff = ocultarSecretos(cambios.diff);
  if (diff.length > MAX_DIFF) diff = diff.slice(0, MAX_DIFF) + "\n[… diff recortado …]";
  return [
    "Escribe el mensaje de commit para estos cambios, en " + (idioma || "español") + ", con el formato Conventional Commits:",
    "tipo(alcance opcional): descripción en imperativo y en minúscula, de 72 caracteres o menos.",
    "Tipos: feat, fix, docs, style, refactor, perf, test, build, ci, chore.",
    "Si hay varios cambios importantes, deja una línea en blanco y agrega hasta 4 viñetas cortas con «- ».",
    "Responde SOLO con el mensaje, sin comillas, sin bloques de código y sin explicaciones.",
    "",
    "Archivos:",
    lista,
    "",
    "Diff:",
    diff,
  ].join("\n");
}

function limpiarRespuesta(t) {
  return (t || "").replace(/^```[a-z]*\n?|```$/gm, "").replace(/^["'«]|["'»]$/g, "").trim();
}

/**
 * Pide el mensaje a Gemini. opciones: { clave, modelo, idioma, fetch } (fetch se puede inyectar para pruebas).
 * Si no hay clave o falla, devuelve el mensaje por reglas y el motivo.
 */
async function sugerirMensaje(cambios, opciones) {
  const o = opciones || {};
  const respaldo = mensajePorReglas(cambios);
  if (!cambios.archivos.length) return { mensaje: "", fuente: "nada", aviso: "No hay cambios en staging." };
  if (!o.clave) return { mensaje: respaldo, fuente: "reglas", aviso: "Sin clave de Gemini: mensaje armado con reglas." };
  const hacerFetch = o.fetch || globalThis.fetch;
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(o.modelo || MODELO_POR_DEFECTO) + ":generateContent";
  try {
    const r = await hacerFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": o.clave },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instrucciones(cambios, o.idioma) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
      }),
    });
    if (!r.ok) {
      const motivo = r.status === 429 ? "Gemini llegó al límite gratuito por ahora" : r.status === 400 || r.status === 403 ? "Gemini rechazó la clave o el modelo" : "Gemini respondió " + r.status;
      return { mensaje: respaldo, fuente: "reglas", aviso: motivo + ": mensaje armado con reglas." };
    }
    const j = await r.json();
    const texto = limpiarRespuesta(j && j.candidates && j.candidates[0] && j.candidates[0].content &&
      (j.candidates[0].content.parts || []).map((p) => p.text || "").join(""));
    if (!texto) return { mensaje: respaldo, fuente: "reglas", aviso: "Gemini no devolvió texto: mensaje armado con reglas." };
    return { mensaje: texto, fuente: "gemini", aviso: null };
  } catch (e) {
    return { mensaje: respaldo, fuente: "reglas", aviso: "No pude conectar con Gemini (" + e.message + "): mensaje armado con reglas." };
  }
}

// ---------------------------------------------------------------- ganchos

const MARCA = "# instalado por La Justicia";

function textoGancho(tipo) {
  const script = __filename.replace(/\\/g, "/");
  const accion = tipo === "pre-commit" ? 'revisar --gancho' : 'gancho-mensaje "$1" "$2"';
  return "#!/bin/sh\n" + MARCA + "\n" +
    'command -v node >/dev/null 2>&1 || exit 0\n' +
    'node "' + script + '" ' + accion + "\n" +
    "exit 0\n";
}

function carpetaGanchos(cwd, global) {
  if (global) return path.join(os.homedir(), ".justicia", "ganchos");
  const dir = git(["rev-parse", "--git-path", "hooks"], cwd).trim();
  return path.resolve(cwd, dir);
}

function instalar(cwd, global) {
  const dir = carpetaGanchos(cwd, global);
  fs.mkdirSync(dir, { recursive: true });
  const hechos = [];
  for (const tipo of ["pre-commit", "prepare-commit-msg"]) {
    const ruta = path.join(dir, tipo);
    if (fs.existsSync(ruta) && !fs.readFileSync(ruta, "utf8").includes(MARCA)) {
      fs.renameSync(ruta, ruta + ".antes-de-justicia");
      hechos.push(tipo + " (el anterior quedó como " + tipo + ".antes-de-justicia)");
    } else hechos.push(tipo);
    fs.writeFileSync(ruta, textoGancho(tipo), { mode: 0o755 });
  }
  if (global) git(["config", "--global", "core.hooksPath", dir.replace(/\\/g, "/")], cwd);
  return { dir, hechos };
}

function desinstalar(cwd, global) {
  const dir = carpetaGanchos(cwd, global);
  for (const tipo of ["pre-commit", "prepare-commit-msg"]) {
    const ruta = path.join(dir, tipo);
    if (fs.existsSync(ruta) && fs.readFileSync(ruta, "utf8").includes(MARCA)) {
      fs.unlinkSync(ruta);
      if (fs.existsSync(ruta + ".antes-de-justicia")) fs.renameSync(ruta + ".antes-de-justicia", ruta);
    }
  }
  if (global) { try { git(["config", "--global", "--unset", "core.hooksPath"], cwd); } catch (e) { /* no estaba */ } }
  return dir;
}

// ---------------------------------------------------------------- salida en texto

const ICONO = { alta: "✖", media: "▲", info: "•" };

function textoAvisos(avisos) {
  if (avisos.length === 0) return "⚖  La Justicia: todo en orden, sin avisos.";
  const lineas = ["⚖  La Justicia: " + avisos.length + (avisos.length === 1 ? " aviso" : " avisos") + " (no bloquea el commit)"];
  for (const a of avisos) {
    lineas.push("  " + ICONO[a.gravedad] + " " + a.archivo + (a.linea ? ":" + a.linea : "") + " — " + a.mensaje);
    lineas.push("      " + a.consejo);
  }
  return lineas.join("\n");
}

function copiarAlPortapapeles(texto) {
  try {
    if (process.platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-Command", "$input | Set-Clipboard"], { input: texto, stdio: ["pipe", "ignore", "ignore"] });
    } else if (process.platform === "darwin") {
      execFileSync("pbcopy", [], { input: texto });
    } else {
      execFileSync("xclip", ["-selection", "clipboard"], { input: texto });
    }
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- CLI

async function principal(args) {
  const cmd = args[0] || "ayuda";
  const cwd = process.cwd();
  const conf = leerConfig();

  if (cmd === "revisar") {
    const avisos = revisar(cambiosEnStaging(cwd));
    process.stderr.write(textoAvisos(avisos) + "\n");
    return 0; // nunca bloquea
  }
  if (cmd === "sugerir") {
    const cambios = cambiosEnStaging(cwd);
    const r = await sugerirMensaje(cambios, conf);
    if (r.aviso) process.stderr.write("⚖  " + r.aviso + "\n");
    process.stdout.write(r.mensaje + "\n");
    if (args.includes("--copiar") && r.mensaje && copiarAlPortapapeles(r.mensaje)) process.stderr.write("⚖  Copiado al portapapeles.\n");
    return 0;
  }
  if (cmd === "gancho-mensaje") {
    // prepare-commit-msg: solo se rellena cuando git va a abrir el editor sin mensaje (origen vacío o plantilla).
    const archivo = args[1], origen = args[2] || "";
    if (!archivo || (origen && origen !== "template")) return 0;
    const actual = fs.readFileSync(archivo, "utf8");
    const sinComentarios = actual.split("\n").filter((l) => !l.startsWith("#")).join("\n").trim();
    if (sinComentarios) return 0;
    const cambios = cambiosEnStaging(cwd);
    const r = await sugerirMensaje(cambios, conf);
    const avisos = revisar(cambios);
    const notas = ["# ⚖ Mensaje sugerido por La Justicia (" + (r.fuente === "gemini" ? "Gemini" : "reglas") + "). Edítalo si quieres."];
    if (r.aviso) notas.push("# " + r.aviso);
    for (const a of avisos) notas.push("# " + ICONO[a.gravedad] + " " + a.archivo + (a.linea ? ":" + a.linea : "") + " — " + a.mensaje);
    fs.writeFileSync(archivo, r.mensaje + "\n\n" + notas.join("\n") + "\n" + actual);
    return 0;
  }
  if (cmd === "instalar" || cmd === "desinstalar") {
    const global = args.includes("--global");
    if (cmd === "instalar") {
      const r = instalar(cwd, global);
      console.log("⚖  Ganchos instalados en " + r.dir + ": " + r.hechos.join(", "));
      if (global) console.log("   Ahora funcionan en TODOS tus repositorios (git config --global core.hooksPath).");
    } else {
      console.log("⚖  Ganchos quitados de " + desinstalar(cwd, global));
    }
    return 0;
  }
  if (cmd === "configurar") {
    if (!args[1]) { console.log("Uso: node justicia.js configurar <clave-de-gemini> [modelo]"); return 1; }
    console.log("⚖  Clave guardada en " + guardarConfig(args[1], args[2]));
    return 0;
  }
  console.log([
    "XI · La Justicia — revisa lo que vas a subir y propone el mensaje del commit",
    "",
    "  node justicia.js revisar                avisos sobre lo que está en staging",
    "  node justicia.js sugerir [--copiar]     mensaje sugerido (Gemini si hay clave)",
    "  node justicia.js instalar [--global]    ganchos de git en este repositorio (o en todos)",
    "  node justicia.js desinstalar [--global]",
    "  node justicia.js configurar <clave> [modelo]",
  ].join("\n"));
  return 0;
}

module.exports = { usarGit, cambiosEnStaging, revisar, ocultarSecretos, mensajePorReglas, sugerirMensaje, leerConfig, guardarConfig,
  instalar, desinstalar, textoAvisos, raizRepo, MODELO_POR_DEFECTO };

if (require.main === module) {
  principal(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    // Un fallo de La Justicia nunca debe impedir el commit.
    process.stderr.write("⚖  La Justicia tuvo un problema y se saltó la revisión: " + e.message + "\n");
    process.exit(0);
  });
}
