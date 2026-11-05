// Pruebas de La Justicia con repositorios de git reales (temporales): node pruebas/justicia.test.js
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const J = require("../nucleo/justicia.js");

let ok = 0, fallos = 0;
const check = (c, n) => { if (c) ok++; else { fallos++; console.log("FALLA: " + n); } };

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "justicia-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Prueba");
  g("config", "user.email", "prueba@example.com");
  g("config", "core.hooksPath", ".git/hooks");
  return { dir, g, escribir: (r, t) => { fs.mkdirSync(path.dirname(path.join(dir, r)), { recursive: true }); fs.writeFileSync(path.join(dir, r), t); } };
}

(async () => {
  // ---------- avisos ----------
  const r = repo();
  r.escribir("src/app.js", "const a = 1;\nconsole.log(a);\nconst api_key = \"abcdef1234567890\";\n// TODO: mejorar\n");
  r.escribir(".env", "GEMINI_API_KEY=AIza" + "x".repeat(35) + "\n");
  r.escribir(".env.example", "GEMINI_API_KEY=\n");
  r.escribir("Main.kt", "fun main() {\n    Log.d(\"T\", \"hola\")\n}\n");
  r.escribir("conflicto.txt", "a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> rama\n");
  r.escribir("build/salida.txt", "generado\n");
  r.escribir("app.apk", Buffer.from([0, 1, 2, 3, 0, 255]));
  r.escribir("gradle/wrapper/gradle-wrapper.jar", Buffer.from([0, 1, 2]));
  r.escribir("db.json", "{\"conn\": \"server=x;uid=u;password=Secreta123;\"}\n");
  r.g("add", "-A");
  const cambios = J.cambiosEnStaging(r.dir);
  check(cambios.archivos.length === 9, "9 archivos en staging: " + cambios.archivos.length);
  const avisos = J.revisar(cambios);
  const hay = (regla, archivo) => avisos.some((a) => a.regla === regla && a.archivo === archivo);
  check(hay("archivo-sensible", ".env"), ".env sensible");
  check(!hay("archivo-sensible", ".env.example"), ".env.example permitido");
  check(hay("secreto", ".env"), "clave de Google en .env");
  check(hay("secreto", "src/app.js"), "api_key en el código");
  check(avisos.find((a) => a.regla === "secreto" && a.archivo === "src/app.js").linea === 3, "línea del secreto = 3");
  check(hay("depuracion", "src/app.js"), "console.log");
  check(hay("depuracion", "Main.kt"), "Log.d en Kotlin");
  check(hay("pendientes", "src/app.js"), "TODO");
  check(avisos.filter((a) => a.regla === "conflicto").length === 3, "tres marcas de conflicto");
  check(hay("carpeta-generada", "build/salida.txt"), "carpeta build");
  check(hay("binario", "app.apk"), "apk binario");
  check(!avisos.some((a) => a.archivo === "gradle/wrapper/gradle-wrapper.jar"), "gradle-wrapper.jar permitido");
  check(hay("secreto", "db.json"), "contraseña en cadena de conexión");
  check(avisos[0].gravedad === "alta" && avisos[avisos.length - 1].gravedad === "info", "ordenados por gravedad");
  check(J.textoAvisos(avisos).includes("no bloquea"), "texto de avisos");
  check(!J.ocultarSecretos(cambios.diff).includes("AIza" + "x".repeat(35)), "los secretos se ocultan antes de mandarlos");

  // ---------- limpio ----------
  const l = repo();
  l.escribir("README.md", "# Hola\n");
  l.g("add", "-A");
  const cl = J.cambiosEnStaging(l.dir);
  check(J.revisar(cl).length === 0, "sin avisos en un README");
  check(J.mensajePorReglas(cl) === "docs: agrega README.md", "mensaje por reglas docs: " + J.mensajePorReglas(cl));

  // ---------- mensaje por reglas ----------
  l.g("commit", "-q", "-m", "inicio");
  l.escribir("src/a.js", "1\n"); l.escribir("src/b.js", "2\n");
  l.g("add", "-A");
  check(J.mensajePorReglas(J.cambiosEnStaging(l.dir)) === "feat(src): agrega 2 archivos", "feat(src): " + J.mensajePorReglas(J.cambiosEnStaging(l.dir)));
  l.g("commit", "-q", "-m", "dos");
  l.escribir("src/a.js", "1\n2\n");
  l.g("add", "-A");
  check(J.mensajePorReglas(J.cambiosEnStaging(l.dir)) === "chore(src): actualiza a.js", "chore: " + J.mensajePorReglas(J.cambiosEnStaging(l.dir)));

  // ---------- Gemini (simulado) ----------
  let pedido = null;
  const fetchOk = async (url, op) => { pedido = { url, op }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "```\nfeat(src): agrega validación de entrada\n```" }] } }] }) }; };
  const g1 = await J.sugerirMensaje(J.cambiosEnStaging(l.dir), { clave: "CLAVE", modelo: "gemini-x", fetch: fetchOk });
  check(g1.fuente === "gemini" && g1.mensaje === "feat(src): agrega validación de entrada", "mensaje de Gemini limpio: " + g1.mensaje);
  check(pedido.url.includes("/models/gemini-x:generateContent") && pedido.op.headers["x-goog-api-key"] === "CLAVE", "llamada a Gemini bien formada");
  check(JSON.parse(pedido.op.body).contents[0].parts[0].text.includes("Conventional Commits"), "instrucciones en el pedido");
  const g2 = await J.sugerirMensaje(J.cambiosEnStaging(l.dir), { clave: "X", fetch: async () => ({ ok: false, status: 429 }) });
  check(g2.fuente === "reglas" && /límite/.test(g2.aviso), "límite de Gemini → reglas");
  const g3 = await J.sugerirMensaje(J.cambiosEnStaging(l.dir), { clave: "", fetch: fetchOk });
  check(g3.fuente === "reglas" && /Sin clave/.test(g3.aviso), "sin clave → reglas");
  const g4 = await J.sugerirMensaje(J.cambiosEnStaging(l.dir), { clave: "X", fetch: async () => { throw new Error("sin red"); } });
  check(g4.fuente === "reglas" && /sin red/.test(g4.aviso), "sin red → reglas");

  // ---------- ganchos de verdad ----------
  const h = repo();
  const inst = J.instalar(h.dir, false);
  check(fs.existsSync(path.join(inst.dir, "pre-commit")) && fs.existsSync(path.join(inst.dir, "prepare-commit-msg")), "ganchos instalados");
  h.escribir("app.js", "console.log('x');\n");
  h.g("add", "-A");
  // commit sin -m: git abre el "editor" (aquí uno que no cambia nada) y usa el mensaje sugerido
  const env = Object.assign({}, process.env, { GIT_EDITOR: "true", GEMINI_API_KEY: "" });
  const salida = execFileSync("git", ["commit"], { cwd: h.dir, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  const mensaje = h.g("log", "-1", "--format=%B").trim();
  check(mensaje === "feat: agrega app.js", "el commit quedó con el mensaje sugerido: «" + mensaje + "»");
  // commit con -m: no toca el mensaje del usuario y no bloquea aunque haya avisos
  h.escribir("otro.js", "console.log('y');\n");
  h.g("add", "-A");
  execFileSync("git", ["commit", "-m", "mi mensaje"], { cwd: h.dir, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  check(h.g("log", "-1", "--format=%B").trim() === "mi mensaje", "respeta el mensaje escrito por el usuario");
  J.desinstalar(h.dir, false);
  check(!fs.existsSync(path.join(inst.dir, "pre-commit")), "ganchos quitados");

  // gancho previo existente se respeta
  const p = repo();
  fs.mkdirSync(path.join(p.dir, ".git", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho mio\n");
  J.instalar(p.dir, false);
  check(fs.existsSync(path.join(p.dir, ".git", "hooks", "pre-commit.antes-de-justicia")), "guarda el gancho anterior");
  J.desinstalar(p.dir, false);
  check(fs.readFileSync(path.join(p.dir, ".git", "hooks", "pre-commit"), "utf8").includes("mio"), "lo restaura al desinstalar");

  for (const d of [r, l, h, p]) fs.rmSync(d.dir, { recursive: true, force: true });
  console.log("ok=" + ok + " fallos=" + fallos);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
