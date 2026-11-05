/*
 * XI · La Justicia para VS Code y Kiro.
 * Botón ⚖ en la vista de Git: revisa lo que está en staging, muestra los avisos en «Problemas»
 * y escribe el mensaje sugerido (Gemini) en la caja del commit. Nunca bloquea el commit.
 */
"use strict";
const vscode = require("vscode");
const path = require("path");
const J = require("./justicia.js");

const CLAVE_SECRETA = "justicia.geminiKey";
let diagnosticos, barra, salida, api;
const ultimaSugerencia = new Map(); // repositorio → mensaje que pusimos (para no pisar lo que escribas tú)
const temporizadores = new Map();

async function activate(context) {
  diagnosticos = vscode.languages.createDiagnosticCollection("justicia");
  salida = vscode.window.createOutputChannel("La Justicia");
  barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  barra.command = "justicia.sugerir";
  context.subscriptions.push(diagnosticos, salida, barra);

  context.subscriptions.push(
    vscode.commands.registerCommand("justicia.sugerir", (scm) => sugerir(context, scm)),
    vscode.commands.registerCommand("justicia.revisar", (scm) => revisarYMostrar(repoDe(scm), true)),
    vscode.commands.registerCommand("justicia.configurarClave", () => configurarClave(context)),
    vscode.commands.registerCommand("justicia.instalarGanchos", (scm) => instalarGanchos(repoDe(scm)))
  );

  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) { vscode.window.showWarningMessage("La Justicia necesita la extensión de Git que trae el editor."); return; }
  const gitExt = ext.isActive ? ext.exports : await ext.activate();
  api = gitExt.getAPI(1);
  if (api.git && api.git.path) J.usarGit(api.git.path);

  const vigilar = (repo) => {
    context.subscriptions.push(repo.state.onDidChange(() => programarRevision(repo)));
    programarRevision(repo);
  };
  api.repositories.forEach(vigilar);
  context.subscriptions.push(api.onDidOpenRepository(vigilar));
}

function deactivate() {}

// ---------- repositorio ----------

function repoDe(scm) {
  if (!api || api.repositories.length === 0) return null;
  if (scm && scm.rootUri) {
    const r = api.repositories.find((x) => x.rootUri.fsPath === scm.rootUri.fsPath);
    if (r) return r;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const r = api.getRepository(editor.document.uri);
    if (r) return r;
  }
  return api.repositories[0];
}

function config() { return vscode.workspace.getConfiguration("justicia"); }

// ---------- avisos ----------

function programarRevision(repo) {
  if (!config().get("revisarAlCambiar", true)) return;
  const k = repo.rootUri.fsPath;
  clearTimeout(temporizadores.get(k));
  temporizadores.set(k, setTimeout(() => revisarYMostrar(repo, false), 800));
}

function revisarYMostrar(repo, mostrarResumen) {
  if (!repo) { vscode.window.showInformationMessage("No hay un repositorio de git abierto."); return null; }
  const raiz = repo.rootUri.fsPath;
  let cambios, avisos;
  try {
    cambios = J.cambiosEnStaging(raiz);
    avisos = J.revisar(cambios);
  } catch (e) {
    salida.appendLine("No se pudo revisar " + raiz + ": " + e.message);
    return null;
  }

  // «Problemas»: un diagnóstico por aviso
  const porArchivo = new Map();
  for (const a of avisos) {
    const uri = vscode.Uri.file(path.join(raiz, a.archivo));
    const linea = Math.max(0, (a.linea || 1) - 1);
    const d = new vscode.Diagnostic(new vscode.Range(linea, 0, linea, 1000), a.mensaje + " " + a.consejo,
      a.gravedad === "alta" ? vscode.DiagnosticSeverity.Warning : a.gravedad === "media" ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Hint);
    d.source = "La Justicia";
    d.code = a.regla;
    if (!porArchivo.has(uri.toString())) porArchivo.set(uri.toString(), { uri, lista: [] });
    porArchivo.get(uri.toString()).lista.push(d);
  }
  // limpia solo los de este repositorio
  diagnosticos.forEach((uri) => { if (uri.fsPath.startsWith(raiz)) diagnosticos.delete(uri); });
  for (const { uri, lista } of porArchivo.values()) diagnosticos.set(uri, lista);

  const graves = avisos.filter((a) => a.gravedad === "alta").length;
  if (cambios.archivos.length === 0) barra.hide();
  else {
    barra.text = avisos.length ? "$(law) " + avisos.length : "$(law) ✓";
    barra.tooltip = avisos.length ? "La Justicia: " + avisos.length + " aviso(s) en lo que vas a subir (clic: sugerir mensaje)" : "La Justicia: sin avisos (clic: sugerir mensaje)";
    barra.backgroundColor = graves ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    barra.show();
  }

  if (mostrarResumen) {
    salida.clear();
    salida.appendLine(J.textoAvisos(avisos));
    if (avisos.length) {
      vscode.window.showWarningMessage("⚖ La Justicia: " + avisos.length + " aviso(s)" + (graves ? ", " + graves + " importante(s)" : "") + ". El commit no se bloquea.",
        "Ver detalles").then((b) => { if (b) vscode.commands.executeCommand("workbench.actions.view.problems"); });
    } else if (cambios.archivos.length) {
      vscode.window.setStatusBarMessage("⚖ La Justicia: sin avisos", 3000);
    }
  }
  return { cambios, avisos };
}

// ---------- mensaje sugerido ----------

async function claveGemini(context) {
  return (await context.secrets.get(CLAVE_SECRETA)) || J.leerConfig().clave || "";
}

async function sugerir(context, scm) {
  const repo = repoDe(scm);
  const r = revisarYMostrar(repo, true);
  if (!r) return;
  if (r.cambios.archivos.length === 0) {
    vscode.window.showInformationMessage("No hay cambios en staging. Agrega archivos (+) y vuelve a pulsar ⚖.");
    return;
  }
  const clave = await claveGemini(context);
  if (!clave) {
    const b = await vscode.window.showInformationMessage("Sin clave de Gemini el mensaje se arma con reglas simples. ¿Configurar la clave?", "Configurar", "Seguir sin clave");
    if (b === "Configurar") { await configurarClave(context); return sugerir(context, scm); }
  }
  const res = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: "La Justicia" },
    () => J.sugerirMensaje(r.cambios, { clave, modelo: config().get("modelo") || J.MODELO_POR_DEFECTO, idioma: config().get("idioma") || "español" })
  );
  if (res.aviso) vscode.window.setStatusBarMessage("⚖ " + res.aviso, 6000);
  if (!res.mensaje) return;

  const caja = repo.inputBox;
  const k = repo.rootUri.fsPath;
  const actual = (caja.value || "").trim();
  if (actual && actual !== ultimaSugerencia.get(k)) {
    const b = await vscode.window.showInformationMessage("Ya escribiste un mensaje. ¿Lo reemplazo por el sugerido?\n\n" + res.mensaje, { modal: true }, "Reemplazar");
    if (b !== "Reemplazar") return;
  }
  caja.value = res.mensaje;
  ultimaSugerencia.set(k, res.mensaje);
}

// ---------- ajustes ----------

async function configurarClave(context) {
  const clave = await vscode.window.showInputBox({
    title: "La Justicia: clave de Gemini",
    prompt: "Pégala desde aistudio.google.com (API keys). Se guarda cifrada en el almacén seguro del editor.",
    password: true, ignoreFocusOut: true,
  });
  if (clave === undefined) return;
  if (!clave.trim()) { await context.secrets.delete(CLAVE_SECRETA); vscode.window.showInformationMessage("Clave de Gemini borrada."); return; }
  await context.secrets.store(CLAVE_SECRETA, clave.trim());
  const b = await vscode.window.showInformationMessage("Clave guardada. ¿Usarla también en los ganchos de git (Visual Studio, terminal)?",
    "Sí, también", "Solo en el editor");
  if (b === "Sí, también") {
    const ruta = J.guardarConfig(clave.trim(), config().get("modelo"));
    vscode.window.showInformationMessage("También quedó en " + ruta + " para los ganchos de git.");
  }
}

async function instalarGanchos(repo) {
  const op = await vscode.window.showQuickPick([
    { label: "Solo este repositorio", global: false, description: repo ? repo.rootUri.fsPath : "" },
    { label: "Todos mis repositorios", global: true, description: "git config --global core.hooksPath" },
  ], { title: "La Justicia: instalar ganchos de git" });
  if (!op) return;
  try {
    const cwd = repo ? repo.rootUri.fsPath : (vscode.workspace.workspaceFolders || [])[0].uri.fsPath;
    const r = J.instalar(cwd, op.global);
    vscode.window.showInformationMessage("⚖ Ganchos instalados: " + r.hechos.join(", ") + ". Ahora también revisa y sugiere desde Visual Studio y la terminal.");
  } catch (e) {
    vscode.window.showErrorMessage("No se pudieron instalar los ganchos: " + e.message);
  }
}

module.exports = { activate, deactivate };
