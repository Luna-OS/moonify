// Läuft in jeder eingebetteten Anbieter-Ansicht (Spotify, YT Music, Amazon Music).
// Liest über die Media Session API aus, was gerade läuft, und nimmt Befehle
// (Play/Pause, Seek, Lautstärke …) von der Moonify-Playerleiste entgegen.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('__moonifyBridge', {
  emit(json) {
    if (typeof json === 'string' && json.length < 20000) ipcRenderer.sendToHost('moonify:state', json);
  },
  onCommand(callback) {
    ipcRenderer.on('moonify:command', (_event, command) => {
      try {
        callback(JSON.stringify(command));
      } catch {
        // Befehl konnte nicht ausgeführt werden – ignorieren
      }
    });
  },
});

// Diese Funktion läuft in der Welt der Webseite, damit sie deren
// Media-Session-Handler und <audio>/<video>-Elemente sehen kann.
function moonifyHook() {
  const bridge = window.__moonifyBridge;
  if (!bridge || window.__moonifyHooked) return;
  window.__moonifyHooked = true;

  const ms = navigator.mediaSession;
  const handlers = Object.create(null);
  let positionState = null;
  let positionStamp = 0;
  let activeMedia = null;
  let desiredVolume = null;
  let lastJson = '';

  if (ms) {
    const originalSetHandler = ms.setActionHandler.bind(ms);
    ms.setActionHandler = function (action, handler) {
      handlers[action] = typeof handler === 'function' ? handler : null;
      return originalSetHandler(action, handler);
    };
    if (typeof ms.setPositionState === 'function') {
      const originalSetPosition = ms.setPositionState.bind(ms);
      ms.setPositionState = function (state) {
        positionState = state ? { duration: state.duration, position: state.position, playbackRate: state.playbackRate } : null;
        positionStamp = performance.now();
        return originalSetPosition(state);
      };
    }
  }

  const proto = HTMLMediaElement.prototype;
  const originalPlay = proto.play;
  proto.play = function () {
    adopt(this);
    return originalPlay.apply(this, arguments);
  };
  document.addEventListener(
    'play',
    (event) => {
      if (event.target instanceof HTMLMediaElement) adopt(event.target);
    },
    true,
  );

  function adopt(element) {
    activeMedia = element;
    applyVolume();
  }

  function findMedia() {
    if (activeMedia && !activeMedia.paused) return activeMedia;
    const elements = Array.from(document.querySelectorAll('audio, video'));
    return elements.find((e) => !e.paused) || activeMedia || elements.find((e) => e.duration > 0) || null;
  }

  function applyVolume() {
    if (desiredVolume === null) return;
    const media = findMedia();
    if (media && Math.abs(media.volume - desiredVolume) > 0.005) media.volume = desiredVolume;
  }

  function call(action, details) {
    const handler = handlers[action];
    if (typeof handler !== 'function') return false;
    try {
      handler(Object.assign({ action }, details));
      return true;
    } catch {
      return false;
    }
  }

  function bestArtwork(artwork) {
    if (!artwork || !artwork.length) return '';
    const size = (a) => {
      const m = /(\d+)x(\d+)/.exec(a.sizes || '');
      return m ? Number(m[1]) * Number(m[2]) : 0;
    };
    const best = Array.from(artwork).sort((a, b) => size(b) - size(a))[0];
    try {
      return new URL(best.src, location.href).href;
    } catch {
      return '';
    }
  }

  function timing(media, playing) {
    const mediaDuration = media && Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    const ps = positionState;
    const psDuration = ps && Number.isFinite(ps.duration) && ps.duration > 0 ? ps.duration : 0;
    if (mediaDuration && (!psDuration || Math.abs(mediaDuration - psDuration) < 1.5)) {
      return { position: media.currentTime, duration: mediaDuration };
    }
    if (psDuration) {
      const rate = Number.isFinite(ps.playbackRate) ? ps.playbackRate : 1;
      const elapsed = playing ? ((performance.now() - positionStamp) / 1000) * rate : 0;
      return { position: Math.min(psDuration, (ps.position || 0) + elapsed), duration: psDuration };
    }
    return { position: 0, duration: 0 };
  }

  let wasPlaying = false;
  function snapshot() {
    const media = findMedia();
    const metadata = ms && ms.metadata;
    const playing = media ? !media.paused && !media.ended : !!ms && ms.playbackState === 'playing';

    // Beim Pausieren/Fortsetzen die hochgerechnete Position einfrieren.
    if (playing !== wasPlaying && positionState) {
      const t = timing(media, wasPlaying);
      positionState.position = t.position;
      positionStamp = performance.now();
    }
    wasPlaying = playing;

    const { position, duration } = timing(media, playing);
    return {
      title: metadata ? metadata.title : '',
      artist: metadata ? metadata.artist : '',
      album: metadata ? metadata.album : '',
      artwork: metadata ? bestArtwork(metadata.artwork) : '',
      playing,
      position: Math.round(position * 4) / 4,
      duration: Math.round(duration * 4) / 4,
      canNext: typeof handlers.nexttrack === 'function',
      canPrev: typeof handlers.previoustrack === 'function',
      canSeek: typeof handlers.seekto === 'function' || !!media,
      url: location.href,
    };
  }

  function tick() {
    applyVolume();
    let json;
    try {
      json = JSON.stringify(snapshot());
    } catch {
      return;
    }
    if (json !== lastJson) {
      lastJson = json;
      bridge.emit(json);
    }
  }

  function spaNavigate(url) {
    let target;
    try {
      target = new URL(url, location.href);
    } catch {
      return;
    }
    if (target.protocol !== 'https:') return;
    if (target.origin !== location.origin) {
      location.href = target.href;
      return;
    }
    history.pushState({}, '', target.pathname + target.search + target.hash);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  bridge.onCommand((json) => {
    const command = JSON.parse(json);
    const media = findMedia();
    switch (command.type) {
      case 'play':
        if (!call('play') && media) media.play();
        break;
      case 'pause':
        if (!call('pause') && media) media.pause();
        break;
      case 'next':
        call('nexttrack');
        break;
      case 'prev':
        call('previoustrack');
        break;
      case 'seek': {
        const time = Number(command.time);
        if (!Number.isFinite(time) || time < 0) break;
        if (!call('seekto', { seekTime: time, fastSeek: false }) && media) media.currentTime = time;
        if (positionState) {
          positionState.position = time;
          positionStamp = performance.now();
        }
        break;
      }
      case 'volume': {
        const volume = Number(command.volume);
        if (Number.isFinite(volume)) desiredVolume = Math.min(1, Math.max(0, volume));
        applyVolume();
        break;
      }
      case 'navigate':
        spaNavigate(String(command.url));
        break;
      default:
        break;
    }
    setTimeout(tick, 120);
  });

  setInterval(tick, 500);
}

if (typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({ func: moonifyHook });
} else {
  webFrame.executeJavaScript(`(${moonifyHook.toString()})()`);
}
