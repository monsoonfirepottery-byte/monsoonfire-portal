param(
  [string] $Only = "firestore,functions,auth",
  [string] $Project = "monsoonfire-portal",
  [string] $Config = "firebase.json"
)

$script = Join-Path $PSScriptRoot "start-emulators.mjs"
node $script --only $Only --project $Project --config $Config
