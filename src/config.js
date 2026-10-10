// The app's registrations with Google and Microsoft. These are public IDs,
// not secrets: they only name the app on the sign-in screen. They give the
// app's maker no access to anyone's data — every request goes straight from
// the person's browser to their own Google or Microsoft account.
//
// Running your own copy? Register your own (see SETUP-WITH-AI.md, "Your own
// registration") and either edit these, or paste them in the app under
// Settings → Advanced, which keeps them on that device only.

export const CONFIG = {
  google: {
    clientId: '',
    apiKey: '', // for the file picker that opens a list someone shared with you
    appId: '', // the Cloud project number
  },
  microsoft: {
    clientId: '',
  },
};

export function config() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem('td-config') || '{}'); } catch { /* none */ }
  return {
    google: { ...CONFIG.google, ...(local.google || {}) },
    microsoft: { ...CONFIG.microsoft, ...(local.microsoft || {}) },
  };
}

export function saveLocalConfig(next) {
  localStorage.setItem('td-config', JSON.stringify(next));
}
