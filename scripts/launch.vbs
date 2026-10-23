Option Explicit
Dim shell, files, root, activeFile, version, appRoot, nodePath, launcher, result, validator
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
appRoot = root
If files.FileExists(files.BuildPath(root, "current.txt")) Then
  Set activeFile = files.OpenTextFile(files.BuildPath(root, "current.txt"), 1)
  version = Trim(activeFile.ReadLine)
  activeFile.Close
  Set validator = New RegExp
  validator.Pattern = "^[0-9]+\.[0-9]+\.[0-9]+$"
  If Not validator.Test(version) Then
    MsgBox "DepthPilot could not read its installed version. Please install the verified download again.", 48, "DepthPilot"
    WScript.Quit 1
  End If
  appRoot = files.BuildPath(files.BuildPath(root, "versions"), version)
End If
nodePath = files.BuildPath(appRoot, "runtime\node.exe")
launcher = files.BuildPath(appRoot, "scripts\launch.mjs")
If Not files.FileExists(nodePath) Or Not files.FileExists(launcher) Then
  MsgBox "Please use the Windows download and extract the whole folder. The source-only download needs Node.js; see README.md.", 48, "DepthPilot"
  WScript.Quit 1
End If
result = shell.Run(Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcher & Chr(34), 0, True)
If result <> 0 Then
  MsgBox "DepthPilot could not open. Your bot history has been kept. See the launcher log in your DepthPilot profile folder, or check the troubleshooting guide.", 48, "DepthPilot"
End If
