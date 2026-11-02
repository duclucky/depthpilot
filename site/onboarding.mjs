export async function copyInstallCommand(text, clipboard) {
  try {
    if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
    await clipboard.writeText(text);
    return {ok: true, message: 'Installation command copied. Paste it into ordinary PowerShell when you are ready.'};
  } catch {
    return {ok: false, message: 'Automatic copy is unavailable. Select the command below and copy it manually.'};
  }
}

if (typeof document !== 'undefined') {
  const revealCommand = () => {
    if (location.hash === '#powershell') document.getElementById('powershell').open = true;
  };
  document.querySelectorAll('a[href="#powershell"]').forEach(anchor => anchor.addEventListener('click', () => {
    document.getElementById('powershell').open = true;
  }));
  addEventListener('hashchange', revealCommand);
  revealCommand();
  const button = document.getElementById('copy-install');
  const command = document.getElementById('install-command');
  const status = document.getElementById('copy-status');
  if (button && command && status) button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await copyInstallCommand(command.textContent, navigator.clipboard);
    status.textContent = result.message;
    button.textContent = result.ok ? 'Copy command again' : 'Try copying again';
    button.disabled = false;
  });
}
