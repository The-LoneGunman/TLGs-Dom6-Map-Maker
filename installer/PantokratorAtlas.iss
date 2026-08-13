#ifndef AppVersion
  #define AppVersion "0.1.1"
#endif

#ifndef PayloadDir
  #define PayloadDir "..\tmp\installer-payload"
#endif

[Setup]
AppId={{953DBDDE-58C4-463C-A80F-FCE37134264D}
AppName=Pantokrator Atlas
AppVersion={#AppVersion}
AppVerName=Pantokrator Atlas {#AppVersion}
AppPublisher=The Lone Gunman
AppPublisherURL=https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker
AppSupportURL=https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/issues
AppUpdatesURL=https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest
AppReadmeFile={app}\README.md
VersionInfoVersion={#AppVersion}.0
DefaultDirName={localappdata}\Programs\Pantokrator Atlas
DefaultGroupName=Pantokrator Atlas
DisableProgramGroupPage=yes
LicenseFile={#PayloadDir}\LICENSE
OutputDir=..\outputs
OutputBaseFilename=Pantokrator-Atlas-Setup-x64
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName=Pantokrator Atlas
UninstallDisplayIcon={sys}\shell32.dll
RestartIfNeededByRun=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Pantokrator Atlas"; Filename: "{app}\Start Pantokrator Atlas.cmd"; WorkingDir: "{app}"
Name: "{group}\User Guide"; Filename: "{app}\docs\USER_GUIDE.md"
Name: "{autodesktop}\Pantokrator Atlas"; Filename: "{app}\Start Pantokrator Atlas.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Start Pantokrator Atlas.cmd"; Description: "Launch Pantokrator Atlas"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent shellexec
