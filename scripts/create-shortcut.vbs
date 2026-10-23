Option Explicit
Dim shell, files, root, shortcut, folder
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = WScript.Arguments(0)
Set shortcut = shell.CreateShortcut(files.BuildPath(shell.SpecialFolders("Desktop"), "DepthPilot.lnk"))
shortcut.TargetPath = files.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32\wscript.exe")
shortcut.Arguments = Chr(34) & files.BuildPath(root, "scripts\launch.vbs") & Chr(34)
shortcut.WorkingDirectory = root
shortcut.Description = "Open your local DepthPilot dashboard"
shortcut.Save
folder = files.BuildPath(shell.SpecialFolders("Programs"), "DepthPilot")
If Not files.FolderExists(folder) Then files.CreateFolder folder
Set shortcut = shell.CreateShortcut(files.BuildPath(folder, "DepthPilot.lnk"))
shortcut.TargetPath = files.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32\wscript.exe")
shortcut.Arguments = Chr(34) & files.BuildPath(root, "scripts\launch.vbs") & Chr(34)
shortcut.WorkingDirectory = root
shortcut.Description = "Open your local DepthPilot dashboard"
shortcut.Save
