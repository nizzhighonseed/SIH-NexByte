Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\LENOVO\gov-risk-management"
WshShell.Run "node server.js", 0, False
