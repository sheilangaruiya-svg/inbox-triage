# VS Code workflow — Smart Inbox Triage

1. **Create the project folder** in VS Code: File → Open Folder → `C:\Users\user\Documents\Cline-Projects\inbox-triage` and copy the project files in.
2. **Open the integrated terminal** (Ctrl+`) — PowerShell is fine.
3. **Run:** `npm.cmd start` → open http://localhost:3000
4. **Test:** `npm.cmd test` (remember: `npm.cmd`, not `npm`, because of the PowerShell execution policy).
5. **Git in VS Code:** Source Control panel (Ctrl+Shift+G) → Initialize Repository → stage all → commit "v1.0 first version".

## Push to a new GitHub repo (first time)
1. On github.com create an empty repo named `inbox-triage` (no README, no .gitignore — we bring our own).
2. In the VS Code terminal:
   ```powershell
   git remote add origin https://github.com/sheilangaruiya-svg/inbox-triage.git
   git branch -M main
   git push -u origin main
   ```
3. Only push once the app runs and tests pass — never a half-finished state.