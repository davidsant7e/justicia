# XI · La Justicia — revisa tu commit

Botón **⚖** en la vista de Git (Control de código fuente):

1. **Revisa lo que vas a subir** (lo que está en *staging*) y deja los avisos en **Problemas**: claves y contraseñas, archivos `.env` o de credenciales, `console.log` / `print` / `Log.d` olvidados, marcas de conflicto, binarios, carpetas generadas (`build/`, `node_modules/`…) y archivos grandes.
2. **Escribe el mensaje del commit** en la caja, con formato *Conventional Commits* (`feat(app): …`), usando **Gemini**. Sin clave, arma uno con reglas simples.

Nunca bloquea el commit: solo avisa. Antes de enviar el diff a Gemini, tapa las claves que encuentre.

Comandos (Ctrl+Shift+P → «La Justicia»): *Revisar y sugerir mensaje*, *Solo revisar*, *Configurar clave de Gemini* (se guarda cifrada) e *Instalar ganchos de git* (para que también funcione desde Visual Studio y la terminal).

Funciona en VS Code y en Kiro.
