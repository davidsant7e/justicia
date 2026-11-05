# XI · La Justicia — revisa tu commit

<p align="center"><img src="docs/carta.svg" alt="XI · La Justicia" width="180"></p>

Antes de cada commit, La Justicia revisa **lo que vas a subir** y te **propone el mensaje del commit**. Nunca bloquea: solo avisa.

**Qué revisa** (solo las líneas que agregas y los archivos en *staging*):

| Gravedad | Qué busca |
|---|---|
| ✖ importante | Claves y contraseñas (Google/Gemini, GitHub, AWS, OpenAI, Anthropic, Slack, llaves privadas, `password=` en cadenas de conexión, `api_key = "…"`), archivos `.env`, `credentials.json`, `.jks` / `.keystore`, llaves `.pem`/`.key`, marcas de conflicto `<<<<<<<` |
| ▲ revisar | Carpetas generadas (`build/`, `bin/`, `obj/`, `node_modules/`, `.gradle/`…), binarios (`.apk`, `.exe`, `.dll`, `.zip`…), archivos de más de 5 MB |
| • para saber | `console.log`, `debugger`, `print(`, `Log.d`, `System.out.println`, `Debug.WriteLine`…, y `TODO`/`FIXME` nuevos |

**El mensaje** lo escribe **Gemini** en formato *Conventional Commits* (`feat(app): agrega …`), en español. Antes de enviar el diff, La Justicia **tapa las claves** que encuentre. Sin clave de Gemini (o si se acaba el cupo gratuito) arma un mensaje con reglas simples.

## Dónde funciona

| | Avisos | Mensaje sugerido |
|---|---|---|
| **VS Code** y **Kiro** (extensión) | En **Problemas** y en la barra de estado (⚖ 2) | Botón ⚖ en la vista de Git → lo escribe en la caja del commit |
| **Visual Studio** (ganchos de git) | En **Salida → Control de código fuente - Git** | Herramienta externa que lo copia al portapapeles ([cómo](visual-studio/LEEME.md)) |
| **Terminal**, Android Studio, cualquier otro | En la consola al hacer `git commit` | `git commit` sin `-m` abre el editor con el mensaje ya escrito |

## Instalar (Windows)

1. Necesitas **Node.js** y **git** (`winget install OpenJS.NodeJS.LTS` y `winget install Git.Git`).
2. Doble clic en **`Instalar.bat`**:
   - instala los ganchos de git para **todos tus repositorios**,
   - te pide la **clave de Gemini** (opcional; se guarda en `%APPDATA%\Justicia\config.json`),
   - instala la extensión en **VS Code** y **Kiro** si los encuentra.
3. Si no encontró VS Code o Kiro: en el editor, **Extensiones → ··· → Instalar desde VSIX…** → `dist\la-justicia-0.1.0.vsix`.

En la extensión, la clave también se puede poner con **Ctrl+Shift+P → La Justicia: Configurar clave de Gemini** (queda cifrada en el editor).

Quitarlo: **`Desinstalar.bat`**.

> Los ganchos globales usan `git config --global core.hooksPath`. Si algún proyecto tuyo usa sus propios ganchos (por ejemplo *husky*), esos dejan de correr mientras La Justicia esté instalada de forma global; en ese caso instálala solo en los repositorios que quieras: `node nucleo\justicia.js instalar` dentro de cada uno.

## Desde la terminal

```text
node nucleo/justicia.js revisar              avisos sobre lo que está en staging
node nucleo/justicia.js sugerir --copiar     mensaje sugerido, copiado al portapapeles
node nucleo/justicia.js instalar [--global]  ganchos en este repositorio (o en todos)
node nucleo/justicia.js configurar <clave>   guarda la clave de Gemini
```

## Código

| Ruta | Qué es |
|---|---|
| `nucleo/justicia.js` | El motor: lee el staging, reglas de aviso, mensaje con Gemini o reglas, ganchos. Sin dependencias. |
| `vscode/` | La extensión para VS Code y Kiro (usa una copia del motor). |
| `visual-studio/LEEME.md` | Cómo usarla en Visual Studio y cómo instalar Visual Studio. |
| `pruebas/justicia.test.js` | Pruebas con repositorios de git reales: `node pruebas/justicia.test.js`. |
| `dist/` | La extensión empaquetada (`.vsix`). |

## Estado

Primera versión (5 nov 2026). Probado: 33 comprobaciones con repositorios de git reales (avisos, mensajes, ganchos con commits de verdad; Gemini simulado) y la extensión con un VS Code simulado. Falta la prueba en tu PC con Gemini real, VS Code, Kiro y Visual Studio.

Ilustraciones propias en estilo duotono · azul noche `#1f2a5c` y durazno `#f4a582`.
