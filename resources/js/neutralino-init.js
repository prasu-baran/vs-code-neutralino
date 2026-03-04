// ============================================================================
//  CodeXplorer — neutralino-init.js
//  NeutralinoJS runtime initialisation.
// ============================================================================

function initNeutralino() {
  if (isNL()) {
    try {
      Neutralino.init();
      Neutralino.events.on('windowClose', () => {
        stopPolling();
        Neutralino.app.exit();
      });
    } catch (e) {
      console.warn('Neutralino.init() failed:', e);
    }
  } else {
    console.log('Running in browser mode (no Neutralino runtime).');
  }
}
