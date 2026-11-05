# La Justicia en Visual Studio

Visual Studio usa git por debajo, así que **los ganchos ya funcionan ahí** apenas ejecutas `Instalar.bat`:

- **Avisos:** en cada commit, La Justicia revisa lo que subes. Los avisos aparecen en **Ver → Salida → «Control de código fuente - Git»**. Nunca bloquea.
- **Mensaje sugerido:** Visual Studio pide escribir el mensaje antes del commit, así que el gancho no puede llenarlo. Para eso agrega este botón (una sola vez):

## Botón «La Justicia: sugerir mensaje»

1. **Herramientas → Herramientas externas… → Agregar**.
2. Llena así:

   | Campo | Valor |
   |---|---|
   | Título | `La Justicia: sugerir mensaje` |
   | Comando | `C:\Program Files\nodejs\node.exe` |
   | Argumentos | `C:\Git\justicia\nucleo\justicia.js sugerir --copiar` |
   | Directorio inicial | `$(SolutionDir)` |
   | Usar ventana de resultados | ✅ marcado |

3. **Aceptar**. Queda en el menú **Herramientas**.

Uso: agrega tus cambios a *staging* en **Cambios de Git**, pulsa **Herramientas → La Justicia: sugerir mensaje** y pega (**Ctrl+V**) en la caja del mensaje. Los avisos salen en la ventana de resultados.

Atajo de teclado (opcional): **Herramientas → Opciones → Entorno → Teclado**, busca `Herramientas.ComandoExterno1` (o el número que le tocó) y asígnale, por ejemplo, `Ctrl+Alt+J`.

## Instalar Visual Studio Community (gratis)

Desde PowerShell, con la carga de trabajo de escritorio .NET (C#):

```powershell
winget install --id Microsoft.VisualStudio.Community -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.ManagedDesktop --includeRecommended"
```

- Necesita unos **10 GB** de disco y tarda un buen rato. Con 8 GB de RAM, mejor no tenerlo abierto junto con Android Studio.
- Si después quieres que hagamos la extensión propia para Visual Studio (un botón dentro de **Cambios de Git**), agrega también `--add Microsoft.VisualStudio.Workload.VisualStudioExtension` (herramientas para crear extensiones de Visual Studio).
