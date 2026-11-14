const SERVER_URL = 'wss://my-chat-server-cklh.onrender.com';
const TURN_API_URL = 'https://myapp222.metered.live/api/v1/turn/credentials?apiKey=xdOg3DmVOkph7BbC-8Gocxvv3ra70YJYCbhFA52FTAIB-cqA';

const fallbackIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

const VAD_THRESHOLD = 0.03;
const VAD_HOLD_MS = 350;
const COMP_TX = [-14, 10, 6, 0.003, 0.2];
const COMP_RX = [-22, 20, 3, 0.01, 0.25];

let ws = null;
let currentRoom = null;
let peerConnection = null;
let dataChannel = null;
let micStream = null;
let micSender = null;
let isMicMuted = true;
let isDeafened = false;
let micStateBeforeDeafen = true;
let screenStream = null;
let screenSender = null;
let screenAudioSender = null;
let streamMuted = false;
let micOut = null;
let txChain = null;
let rx = null;
let noiseIsolation = true;
let pendingCandidates = [];
let connectTimeout = null;
let myId = Math.random().toString(36).slice(2, 8);
let roomMembers = [];
let lastCount = 0;
let peer = null;
let speaking = false;
let actx = null;
let vadTimer = null;
let lastLoud = 0;
let micTestNode = null;
let myAvatar = localStorage.getItem('chat_avatar') || '';
let myStatusNote = localStorage.getItem('chat_status_note') || '';
let linkStatusAr = 'غير متصل';

const $ = (id) => document.getElementById(id);
const lbl = (b) => b.querySelector('.lbl') || b;
const chatBox = $('chat-box');
const msgInput = $('msgInput');
const sendBtn = $('sendBtn');
const startBtn = $('startBtn');
const micBtn = $('micBtn');
const deafenBtn = $('deafenBtn');
const screenBtn = $('screenBtn');
const volumeSlider = $('volumeSlider');
const streamVolSlider = $('streamVolSlider');
const remoteAudio = $('remoteAudio');
const remoteVideo = $('remoteVideo');
const videoContainer = $('videoContainer');
const fullscreenBtn = $('fullscreenBtn');
const streamAudioBtn = $('streamAudioBtn');
const usernameInput = $('usernameInput');
const roomInput = $('roomInput');
const joinRoomBtn = $('joinRoomBtn');
const roomCountBadge = $('roomCount');
const linkText = $('linkText');
const pingEl = $('ping');
const membersEl = $('members');
const copyBtn = $('copyBtn');
const nsBtn = $('nsBtn');
const appEl = $('app');

usernameInput.value = localStorage.getItem('chat_user') || '';
roomInput.value = localStorage.getItem('chat_room') || 'squad';
usernameInput.addEventListener('input', () => localStorage.setItem('chat_user', usernameInput.value));
usernameInput.addEventListener('change', () => {
    sendJoin();
    sendHello();
    renderMembers();
});

function getMyName() {
    return usernameInput.value.trim() || tr('أنت');
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}
const initial = (s) => (String(s || '?').trim().charAt(0) || '?').toUpperCase();
const colorOf = (s) => `hsl(${[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 52%)`;

function setAvatarNode(node, name, avData) {
    if (avData) {
        node.textContent = '';
        node.style.backgroundImage = `url(${avData})`;
    } else {
        node.style.backgroundImage = '';
        node.textContent = initial(name);
        node.style.backgroundColor = colorOf(name);
    }
}

let lastMsg = { s: '', t: 0 };
let unread = 0;
let rooms = [];
try { rooms = JSON.parse(localStorage.getItem('chat_rooms') || '[]'); } catch {}
let typingTimer = null;
let typingSent = 0;
const closePops = () => document.querySelectorAll('.pop.open').forEach((p) => p.classList.remove('open'));

function toast(text) {
    text = tr(text);
    const t = el('div', 'toast', text);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
}

function pushChat(node) {
    chatBox.appendChild(node);
    while (chatBox.childElementCount > 300) chatBox.firstElementChild.remove();
    chatBox.scrollTop = chatBox.scrollHeight;
}

function sys(text, color = '#949ba4') {
    text = tr(text);
    lastMsg = { s: '', t: 0 };
    const ic = color === '#4ade80' ? 'check' : color === '#f87171' || color === '#fbbf24' ? 'warn' : 'info';
    const p = el('p', 'sys');
    p.innerHTML = `<svg class="ic"><use href="#i-${ic}"/></svg>`;
    p.append(el('span', '', text));
    p.style.setProperty('--sc', color);
    pushChat(p);
}

function addMsg(sender, text, mine, key, ts) {
    key = key || `${cur.s}:${cur.c}`;
    if (!replay) {
        (hist[key] = hist[key] || []).push({ s: sender, t: text, m: mine, ts: Date.now() });
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveSrv, 1500);
        if (key !== `${cur.s}:${cur.c}`) {
            unreadCh[key] = 1;
            renderChannels();
            return;
        }
    }
    const head = el('div', 'head');
    head.append(el('b', '', sender), el('time', '', new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    const bubble = el('div', 'bubble');
    bubble.append(head, el('div', 'text', text));
    const cont = lastMsg.s === sender && Date.now() - lastMsg.t < 120000;
    lastMsg = { s: sender, t: Date.now() };
    const row = el('div', 'msg' + (mine ? ' me' : '') + (cont ? ' cont' : ''));
    const av = el('div', 'avatar');
    const avData = mine ? myAvatar : (peer && peer.avatar);
    setAvatarNode(av, sender, avData);
    head.firstChild.style.setProperty('--c', colorOf(sender));
    row.append(av, bubble);
    pushChat(row);
    if (!mine) {
        $('typing').textContent = '';
        if (!replay && (document.hidden || !document.hasFocus())) {
            unread++;
            document.title = `(${unread}) شات خفيف ⚡`;
            sfx('msg');
        }
    }
}

function setLink(text, cls) {
    linkStatusAr = text;
    tx(linkText, text);
    if (myStatusNote) $('meStatus').textContent = myStatusNote;
    else tx($('meStatus'), text);
    $('meStatus').parentElement.className = 'st ' + cls;
    linkText.className = 'badge ' + cls;
}

function showPing(ms) {
    pingEl.textContent = ms + ' ms';
    pingEl.className = 'badge ' + (ms < 80 ? 'good' : ms < 200 ? 'mid' : 'bad');
}

function renderMembers() {
    const list = roomMembers.slice();
    if (!list.some((m) => m.id === myId)) list.unshift({ id: myId, name: '' });
    if (peer && !list.some((m) => m.id === peer.id)) list.push({ id: peer.id, name: peer.name });
    roomCountBadge.textContent = list.length;
    const meEl = $('meAvatar');
    setAvatarNode(meEl, getMyName(), myAvatar);
    meEl.classList.toggle('ring', speaking);
    if (myStatusNote) $('meStatus').textContent = myStatusNote;
    else tx($('meStatus'), linkStatusAr);
    renderChannels();
    membersEl.replaceChildren(...list.map((m) => {
        const isMe = m.id === myId;
        const p = !isMe && peer && peer.id === m.id ? peer : null;
        const st = isMe ? { muted: isMicMuted, deaf: isDeafened, speaking } : p || {};
        const name = isMe ? getMyName() : m.name || (p && p.name) || tr('مجهول');
        const sub = isMe ? (myStatusNote || tr('أنت')) : ((p && p.status) || tr(p ? 'متصل P2P' : 'في الروم'));
        const info = el('div', 'info');
        info.append(el('span', 'nm', name), el('small', '', sub));
        const li = el('li', st.speaking ? 'member speaking' : 'member');
        const av = el('div', 'avatar');
        setAvatarNode(av, name, isMe ? myAvatar : (p && p.avatar));
        li.append(av, info, el('span', '', st.deaf ? '🔕' : st.muted ? '🔇' : ''));
        return li;
    }));
}

// ===== مؤثرات صوتية =====
function getCtx() {
    if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        actx.onstatechange = applyRemoteAudio;
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
}
document.addEventListener('pointerdown', getCtx, { once: true });

const SFX = { join: [523, 784], connect: [440, 660, 880], mute: [330], unmute: [660], msg: [880, 1175], deafen: [330, 247], undeafen: [247, 330] };
function sfx(name) {
    if (!notifOn && (name === 'msg' || name === 'join')) return;
    try {
        const ctx = getCtx();
        const dur = 0.09;
        const t0 = ctx.currentTime;
        SFX[name].forEach((f, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            const s = t0 + i * dur;
            o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, s);
            g.gain.exponentialRampToValueAtTime(0.05, s + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
            o.connect(g).connect(ctx.destination);
            o.start(s);
            o.stop(s + dur + 0.02);
        });
    } catch {}
}

// ===== كشف التحدث + مزامنة الحالة =====
function startVAD(node) {
    clearInterval(vadTimer);
    const ctx = getCtx();
    const analyser = ctx.createAnalyser();
    const buf = new Uint8Array(512);
    analyser.fftSize = 512;
    node.connect(analyser);
    vadTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (!isMicMuted && rms > VAD_THRESHOLD) lastLoud = now;
        setSpeaking(now - lastLoud < VAD_HOLD_MS);
        if (micTestNode) $('micMeter').style.width = Math.min(100, Math.round(rms * 400)) + '%';
    }, 80);
}

function setSpeaking(v) {
    if (v === speaking) return;
    speaking = v;
    renderMembers();
    sendState();
}

function dcSend(obj) {
    if (dataChannel && dataChannel.readyState === 'open') dataChannel.send(JSON.stringify(obj));
}
function sendState() {
    dcSend({ t: 'state', muted: isMicMuted, deaf: isDeafened, speaking });
}
function sendHello() {
    dcSend({ t: 'hello', id: myId, name: usernameInput.value.trim(), avatar: myAvatar, status: myStatusNote, typing: 1 });
    syncServer();
    sendState();
}
setInterval(() => dcSend({ t: 'ping', ts: Date.now() }), 3000);

// ===== سلسلة الصوت وعزل الضوضاء والأجهزة =====
function makeComp(ctx, [threshold, knee, ratio, attack, release]) {
    const n = ctx.createDynamicsCompressor();
    n.threshold.value = threshold;
    n.knee.value = knee;
    n.ratio.value = ratio;
    n.attack.value = attack;
    n.release.value = release;
    return n;
}

function setupMicChain(stream) {
    const ctx = getCtx();
    const src = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85;
    const comp = makeComp(ctx, COMP_TX);
    const proc = ctx.createGain();
    const raw = ctx.createGain();
    const mix = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    proc.gain.value = noiseIsolation ? 1 : 0;
    raw.gain.value = noiseIsolation ? 0 : 1;
    src.connect(hp);
    hp.connect(comp);
    comp.connect(proc);
    proc.connect(mix);
    src.connect(raw);
    raw.connect(mix);
    mix.connect(dest);
    txChain = { proc, raw, mix };
    micOut = dest.stream;
    startVAD(mix);
}

function setupRemoteChain(stream) {
    if (rx) {
        rx.src.disconnect();
        rx.out.disconnect();
        rx = null;
    }
    try {
        const ctx = getCtx();
        const src = ctx.createMediaStreamSource(stream);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 100;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 7500;
        const comp = makeComp(ctx, COMP_RX);
        const out = ctx.createGain();
        out.gain.value = 0;
        src.connect(hp);
        hp.connect(lp);
        lp.connect(comp);
        comp.connect(out);
        out.connect(ctx.destination);
        rx = { src, out };
    } catch {
        rx = null;
    }
}

function applyRemoteAudio() {
    const vol = Number(volumeSlider.value);
    const viaChain = noiseIsolation && !!rx && !!actx && actx.state === 'running';
    remoteAudio.muted = viaChain || isDeafened;
    remoteAudio.volume = vol;
    if (rx) rx.out.gain.setTargetAtTime(viaChain && !isDeafened ? vol : 0, actx.currentTime, 0.02);
}

function applyIsolation() {
    if (txChain) {
        const t = actx.currentTime;
        txChain.proc.gain.setTargetAtTime(noiseIsolation ? 1 : 0, t, 0.02);
        txChain.raw.gain.setTargetAtTime(noiseIsolation ? 0 : 1, t, 0.02);
    }
    const track = micStream && micStream.getAudioTracks()[0];
    if (track) track.applyConstraints({ echoCancellation: true, noiseSuppression: noiseIsolation, autoGainControl: noiseIsolation }).catch(() => {});
    applyRemoteAudio();
}

nsBtn.onclick = () => {
    noiseIsolation = !noiseIsolation;
    tx(lbl(nsBtn), noiseIsolation ? 'عزل الضوضاء: شغال 🪄' : 'عزل الضوضاء: مطفي 🪄');
    nsBtn.classList.toggle('active', noiseIsolation);
    applyIsolation();
    sys(`عزل الضوضاء: ${noiseIsolation ? 'شغال' : 'مطفي'}`);
};

async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const mics = devs.filter((d) => d.kind === 'audioinput');
        const spks = devs.filter((d) => d.kind === 'audiooutput');
        $('micSelect').replaceChildren(...mics.map((d, i) => {
            const o = el('option', '', d.label || `${tr('المايك')} ${i + 1}`);
            o.value = d.deviceId;
            return o;
        }));
        $('spkSelect').replaceChildren(...spks.map((d, i) => {
            const o = el('option', '', d.label || `${tr('السماعة')} ${i + 1}`);
            o.value = d.deviceId;
            return o;
        }));
        if (localStorage.getItem('chat_mic')) $('micSelect').value = localStorage.getItem('chat_mic');
        if (localStorage.getItem('chat_spk')) $('spkSelect').value = localStorage.getItem('chat_spk');
    } catch {}
}

$('micSelect').onchange = async () => {
    localStorage.setItem('chat_mic', $('micSelect').value);
    if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
        await openMicStream();
    }
};

$('spkSelect').onchange = async () => {
    const id = $('spkSelect').value;
    localStorage.setItem('chat_spk', id);
    if (remoteAudio.setSinkId) remoteAudio.setSinkId(id).catch(() => {});
    if (remoteVideo.setSinkId) remoteVideo.setSinkId(id).catch(() => {});
};

$('micTestBtn').onclick = async () => {
    if (micTestNode) {
        micTestNode.disconnect();
        micTestNode = null;
        $('micTestBtn').classList.remove('active');
        $('micMeter').style.width = '0%';
        return;
    }
    if (!micStream) await openMicStream();
    if (txChain) {
        micTestNode = getCtx().createGain();
        micTestNode.gain.value = 0.85;
        txChain.mix.connect(micTestNode).connect(getCtx().destination);
        $('micTestBtn').classList.add('active');
    }
};

function openProfileDlg() {
    let tempAv = myAvatar;
    const stInp = inp(myStatusNote, 'اكتب حالتك (مثلاً: يلعب Warzone)');
    const pick = el('button', 'chip', tr('رفع صورة'));
    pick.onclick = () => {
        const f = el('input');
        f.type = 'file';
        f.accept = 'image/*';
        f.onchange = async () => {
            try {
                tempAv = await compressImg(f.files[0]);
                pick.textContent = tr('تم ✓');
            } catch {
                toast('الصورة كبيرة أو غير صالحة');
            }
        };
        f.click();
    };
    const rem = el('button', 'chip', tr('إزالة الصورة'));
    rem.onclick = () => {
        tempAv = '';
        pick.textContent = tr('رفع صورة');
    };
    const row = el('div', 'seg');
    row.append(pick, rem);
    openDlg('تعديل البروفايل', [['صورة البروفايل (64×64)', row], ['الحالة المخصصة', stInp]], [
        ['حفظ', () => {
            myAvatar = tempAv;
            myStatusNote = stInp.value.trim().slice(0, 40);
            localStorage.setItem('chat_avatar', myAvatar);
            localStorage.setItem('chat_status_note', myStatusNote);
            closeDlg();
            renderMembers();
            sendHello();
        }, 'cta']
    ]);
}

// ===== الثيمات والإيموجي ومؤشر الكتابة =====
const ACCENTS = ['#5865f2', '#3ba55d', '#eb459e', '#f0b232', '#00b0f4', '#f23f43'];
function setAccent(c) {
    document.documentElement.style.setProperty('--accent', c);
    localStorage.setItem('chat_accent', c);
    document.querySelectorAll('#sws i').forEach((i) => i.classList.toggle('on', i.dataset.c === c));
}
function setTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('chat_theme', t);
    $('themeBtn').classList.toggle('active', t === 'midnight');
}

function showTyping() {
    $('typing').textContent = tr(`${(peer && peer.name) || 'صاحبك'} يكتب...`);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => ($('typing').textContent = ''), 3000);
}

function initUI() {
    ACCENTS.forEach((c) => {
        const i = el('i');
        i.style.background = c;
        i.dataset.c = c;
        i.onclick = () => setAccent(c);
        $('sws').appendChild(i);
    });
    setAccent(localStorage.getItem('chat_accent') || ACCENTS[0]);
    setTheme(localStorage.getItem('chat_theme') || 'dark');
    $('themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'midnight' ? 'dark' : 'midnight');
    $('profileBtn').onclick = () => { closePops(); openProfileDlg(); };
    $('meAvatar').onclick = openProfileDlg;
    for (const [b, p] of [['settingsBtn', 'settingsPop'], ['emojiBtn', 'emojiPop']]) {
        $(b).onclick = (e) => {
            e.stopPropagation();
            const open = !$(p).classList.contains('open');
            closePops();
            $(p).classList.toggle('open', open);
            if (open && p === 'settingsPop') refreshDevices();
        };
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.pop')) closePops();
    });
    '😀 😂 🥹 😍 😎 🤔 😭 😡 👍 👎 🙏 👏 🔥 💯 ❤️ 🎉 😴 🤝 👀 ✨ 🎮 🎧 💀 🤣 😅 🙌 😮 😉 🥳 😬 🤯 👋'.split(' ').forEach((e) => {
        const b = el('button', '', e);
        b.onclick = () => {
            msgInput.value += e;
            msgInput.focus();
        };
        $('eg').appendChild(b);
    });
    msgInput.addEventListener('input', () => {
        if (peer && peer.typing && Date.now() - typingSent > 2500) {
            typingSent = Date.now();
            dcSend({ t: 'typing' });
        }
    });
    window.addEventListener('focus', () => {
        unread = 0;
        document.title = tr('شات خفيف ⚡');
    });
}

// ===== بث الشاشة + خيارات العرض للطرفين + التحكم عن بعد =====
const RES = { 720: 1280, 1080: 1920, 1440: 2560, 2160: 3840 };
const SEG_KEYS = { segRes: 'h', segFps: 'fps', segBr: 'br' };
let shareCfg = { h: 1080, w: 1920, fps: 60, br: 0, kbps: 0, audio: false, opt: true };
try { Object.assign(shareCfg, JSON.parse(localStorage.getItem('chat_share') || '{}')); } catch {}
let vsTimer = null;
let vsBytes = 0;
let vsTime = 0;
let nerdTimer = null;
const resLabel = (h) => (h >= 2160 ? '4K' : h + 'p');

// حالة التحكم عن بعد
const TAURI = window.__TAURI__;
const tauriInvoke = TAURI && TAURI.core ? TAURI.core.invoke : null;
let rcHostMode = 'off'; // لدى صاحب البث: 'off' | 'game' | 'desktop'
let rcHostApproved = false;
let rcActive = false; // لدى المشاهد: هل التحكم نشط حالياً
let rcLastMove = 0;

async function refreshWindows() {
    if (!tauriInvoke) return;
    try {
        const list = await tauriInvoke('get_open_windows');
        const sel = $('rcWin');
        const prev = sel.value;
        sel.replaceChildren(...list.map(([hwnd, title]) => {
            const o = el('option', '', title.slice(0, 36));
            o.value = String(hwnd);
            return o;
        }));
        if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    } catch {}
}

function setHostRcMode(mode) {
    rcHostMode = mode;
    $('rcMode').value = mode;
    const isGame = mode === 'game';
    $('rcWin').hidden = !isGame;
    $('rcWinRef').hidden = !isGame;
    if (isGame) refreshWindows();
    if (mode === 'off') {
        rcHostApproved = false;
        $('rcAsk').hidden = true;
        dcSend({ t: 'RC_STOP' });
    } else if (rcHostApproved) {
        dcSend({ t: 'RC_GRANT', ok: true, mode });
    }
}

// مستمعات المشاهد (تعمل فقط عند تفعيل التحكم -> 0% Idle CPU)
function sendRcMove(e) {
    const now = performance.now();
    if (now - rcLastMove < 16) return;
    rcLastMove = now;
    if (document.pointerLockElement === remoteVideo) {
        dcSend({ t: 'RC_IN', p: { kind: 'rel', dx: Math.round(e.movementX), dy: Math.round(e.movementY) } });
    } else {
        const r = remoteVideo.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        dcSend({ t: 'RC_IN', p: { kind: 'move', x, y } });
    }
}
function sendRcDown(e) {
    e.preventDefault();
    remoteVideo.focus();
    dcSend({ t: 'RC_IN', p: { kind: 'down', btn: e.button } });
}
function sendRcUp(e) {
    e.preventDefault();
    dcSend({ t: 'RC_IN', p: { kind: 'up', btn: e.button } });
}
function sendRcWheel(e) {
    e.preventDefault();
    dcSend({ t: 'RC_IN', p: { kind: 'wheel', dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) } });
}
function sendRcKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && e.code === 'End') return;
    e.preventDefault();
    if (!e.repeat) dcSend({ t: 'RC_IN', p: { kind: 'kdown', code: e.code } });
}
function sendRcKeyUp(e) {
    e.preventDefault();
    dcSend({ t: 'RC_IN', p: { kind: 'kup', code: e.code } });
}

function setViewerRc(on) {
    if (rcActive === on) return;
    rcActive = on;
    videoContainer.classList.toggle('rc-active', on);
    $('rcReqBtn').classList.toggle('rc-on', on);
    tx(lbl($('rcReqBtn')), on ? 'التحكم نشط' : 'طلب التحكم');
    $('rcLockBtn').hidden = !on;
    $('rcBanner').hidden = !on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    remoteVideo[method]('mousemove', sendRcMove);
    remoteVideo[method]('mousedown', sendRcDown);
    remoteVideo[method]('mouseup', sendRcUp);
    remoteVideo[method]('wheel', sendRcWheel, { passive: false });
    remoteVideo[method]('keydown', sendRcKeyDown);
    remoteVideo[method]('keyup', sendRcKeyUp);
    if (on) {
        remoteVideo.focus();
        toast('تم تفعيل التحكم عن بُعد 🎮');
    } else if (document.pointerLockElement === remoteVideo) {
        document.exitPointerLock();
    }
}

function calcShare() {
    if (!RES[shareCfg.h]) shareCfg.h = 1080;
    shareCfg.w = RES[shareCfg.h];
    const auto = Math.round((shareCfg.w * shareCfg.h * shareCfg.fps * 0.07) / 1000);
    shareCfg.kbps = shareCfg.br || Math.min(40000, Math.max(1000, auto));
}

function syncShareUI() {
    calcShare();
    document.querySelectorAll('#shareModal .seg').forEach((seg) => {
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(shareCfg[SEG_KEYS[seg.id]]) === b.dataset.v));
    });
    $('shareAudioBtn').classList.toggle('active', shareCfg.audio);
    $('shareOptBtn').classList.toggle('active', shareCfg.opt);
    $('shareEst').textContent = `≈ ${(shareCfg.kbps / 1000).toFixed(1)} Mbps ${tr('رفع')} · ${resLabel(shareCfg.h)} ${shareCfg.fps}fps` + (shareCfg.kbps >= 15000 ? tr(' — جودة عالية جداً، تأكد من سرعة الرفع وقوة الجهاز') : '');
}

function openShare() {
    syncShareUI();
    $('shareModal').hidden = false;
}

async function applyScreenParams() {
    if (!screenSender || !screenStream) return;
    try {
        const p = screenSender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = shareCfg.kbps * 1000;
        p.encodings[0].maxFramerate = shareCfg.fps;
        p.degradationPreference = shareCfg.opt ? 'maintain-framerate' : 'maintain-resolution';
        await screenSender.setParameters(p);
    } catch {}
}

function showLive(on) {
    $('liveBar').hidden = !on;
    $('localPreview').srcObject = on ? screenStream : null;
    if (on) $('liveInfo').textContent = `${resLabel(shareCfg.h)} · ${shareCfg.fps}fps · ${tr('حتى')} ${(shareCfg.kbps / 1000).toFixed(1)} Mbps`;
    else setHostRcMode('off');
    if (on && shareCfg.opt) document.documentElement.dataset.opt = '1';
    else delete document.documentElement.dataset.opt;
}

async function updateShareLive() {
    const track = screenStream.getVideoTracks()[0];
    track.contentHint = shareCfg.opt ? 'motion' : 'detail';
    try {
        await track.applyConstraints({ width: { ideal: shareCfg.w }, height: { ideal: shareCfg.h }, frameRate: { ideal: shareCfg.fps, max: shareCfg.fps } });
    } catch {}
    applyScreenParams();
    showLive(true);
}

function startVideoStats() {
    clearInterval(vsTimer);
    vsBytes = 0;
    vsTime = 0;
    vsTimer = setInterval(async () => {
        if (!peerConnection) return;
        try {
            (await peerConnection.getStats()).forEach((r) => {
                if (r.type !== 'inbound-rtp' || r.kind !== 'video' || !r.frameWidth) return;
                const kbps = vsTime ? Math.round(((r.bytesReceived - vsBytes) * 8) / (r.timestamp - vsTime)) : 0;
                vsBytes = r.bytesReceived;
                vsTime = r.timestamp;
                $('vstats').textContent = `${resLabel(r.frameHeight)} · ${Math.round(r.framesPerSecond || 0)}fps · ${(kbps / 1000).toFixed(1)} Mbps`;
            });
        } catch {}
    }, 1000);
}

async function nerdTick() {
    if (!$('nerdPop').classList.contains('open')) return clearInterval(nerdTimer);
    if (!peerConnection || peerConnection.connectionState !== 'connected') {
        $('nerdBody').textContent = tr('غير متصل');
        return;
    }
    let ice = 'Direct P2P';
    let rtt = 0;
    let v = {};
    const st = await peerConnection.getStats();
    st.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
            const l = st.get(r.localCandidateId);
            const m = st.get(r.remoteCandidateId);
            if ((l && l.candidateType === 'relay') || (m && m.candidateType === 'relay')) ice = 'TURN Relay';
            rtt = Math.round((r.currentRoundTripTime || 0) * 1000);
        }
        if (r.type === 'inbound-rtp' && r.kind === 'video') v = r;
    });
    const total = (v.packetsReceived || 0) + (v.packetsLost || 0);
    $('nerdBody').textContent = [
        `الربط: ${ice}`,
        `البنق: ${rtt} ms`,
        `فقدان الحزم: ${total ? ((100 * (v.packetsLost || 0)) / total).toFixed(1) : 0}%`,
        `البث: ${v.frameWidth ? `${v.frameWidth}×${v.frameHeight} @ ${Math.round(v.framesPerSecond || 0)}fps` : '—'}`
    ].map(tr).join('\n');
}

function toggleFs(el) {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
}

function initShareUI() {
    document.querySelectorAll('#shareModal .seg').forEach((seg) => {
        seg.onclick = (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            shareCfg[SEG_KEYS[seg.id]] = Number(b.dataset.v);
            syncShareUI();
        };
    });
    const closeShare = () => ($('shareModal').hidden = true);
    $('shareAudioBtn').onclick = () => { shareCfg.audio = !shareCfg.audio; syncShareUI(); };
    $('shareOptBtn').onclick = () => { shareCfg.opt = !shareCfg.opt; syncShareUI(); };
    $('shareX').onclick = closeShare;
    $('shareCancel').onclick = closeShare;
    $('shareModal').onclick = (e) => { if (e.target.id === 'shareModal') closeShare(); };
    $('shareGo').onclick = async () => {
        closeShare();
        localStorage.setItem('chat_share', JSON.stringify(shareCfg));
        if (screenStream) await updateShareLive();
        else await startShare();
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeShare();
            closePops();
        }
    });
    $('qualityBtn').onclick = openShare;
    $('stopShareBtn').onclick = stopScreenShare;

    // خيارات العرض للطرفين (مسرح + شاشة كاملة + دبل كليك)
    $('hidePreviewBtn').onclick = () => {
        $('localPreview').hidden = !$('localPreview').hidden;
    };
    $('hostTheaterBtn').onclick = () => $('liveBar').classList.toggle('theater');
    $('hostFsBtn').onclick = () => toggleFs($('liveBar'));
    $('localPreview').ondblclick = () => toggleFs($('liveBar'));

    $('theaterBtn').onclick = () => videoContainer.classList.toggle('theater');
    fullscreenBtn.onclick = () => toggleFs(videoContainer);
    remoteVideo.ondblclick = () => {
        if (!rcActive) toggleFs(videoContainer);
    };

    // أزرار التحكم عن بعد
    $('rcMode').onchange = () => setHostRcMode($('rcMode').value);
    $('rcWinRef').onclick = refreshWindows;
    $('rcAllowGame').onclick = () => {
        rcHostApproved = true;
        $('rcAsk').hidden = true;
        setHostRcMode('game');
    };
    $('rcAllowDesk').onclick = () => {
        rcHostApproved = true;
        $('rcAsk').hidden = true;
        setHostRcMode('desktop');
    };
    $('rcDenyBtn').onclick = () => {
        rcHostApproved = false;
        $('rcAsk').hidden = true;
        dcSend({ t: 'RC_STOP' });
    };
    $('rcReqBtn').onclick = () => {
        if (rcActive) {
            setViewerRc(false);
            dcSend({ t: 'RC_STOP' });
        } else {
            dcSend({ t: 'RC_REQ' });
            toast('تم إرسال طلب التحكم لصاحب البث...');
        }
    };
    $('rcLockBtn').onclick = () => {
        if (remoteVideo.requestPointerLock) remoteVideo.requestPointerLock();
    };

    $('pipBtn').onclick = () => {
        if (remoteVideo.requestPictureInPicture) remoteVideo.requestPictureInPicture().catch(() => {});
        else toast('النافذة العائمة مش مدعومة هون');
    };
    $('shotBtn').onclick = () => {
        if (!remoteVideo.videoWidth) return;
        const c = document.createElement('canvas');
        c.width = remoteVideo.videoWidth;
        c.height = remoteVideo.videoHeight;
        c.getContext('2d').drawImage(remoteVideo, 0, 0);
        c.toBlob((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `screenshot-${Date.now()}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
    };
    linkText.onclick = (e) => {
        e.stopPropagation();
        const open = !$('nerdPop').classList.contains('open');
        closePops();
        $('nerdPop').classList.toggle('open', open);
        clearInterval(nerdTimer);
        if (open) {
            nerdTick();
            nerdTimer = setInterval(nerdTick, 1000);
        }
    };
}

// ===== تقفيل سلوك المتصفح + اختصارات Tauri =====
document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea') && !rcActive) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
    if (!rcActive && (e.key === 'F5' || (e.ctrlKey && ['r', 'p', 'f', '+', '-', '=', '0'].includes(e.key.toLowerCase())))) e.preventDefault();
});
document.addEventListener('wheel', (e) => {
    if (e.ctrlKey && !rcActive) e.preventDefault();
}, { passive: false });

if (TAURI && TAURI.event) {
    TAURI.event.listen('toggle-mic', () => micBtn.click());
    TAURI.event.listen('kill-switch', () => {
        if (rcActive) setViewerRc(false);
        if (rcHostMode !== 'off') setHostRcMode('off');
        if (screenStream) stopScreenShare();
        toast('تم إيقاف البث والتحكم (زر الطوارئ)');
    });
}

// ===== اللغتين: عربي ⇄ English =====
const EN = {
    'شات خفيف ⚡': 'Lite Chat ⚡',
    'نسخ': 'Copy',
    'نسخ الدعوة': 'Copy invite',
    'صوت البث': 'Stream audio',
    'تكبير': 'Fullscreen',
    'مسرح': 'Theater',
    'معاينة': 'Preview',
    'الإشعارات': 'Notifications',
    'تم ✓': 'Done ✓',
    'نسخ كود الدعوة': 'Copy invite code',
    'إعدادات السيرفر': 'Server settings',
    'المتواجدون —': 'Members —',
    'القنوات النصية': 'Text channels',
    'القنوات الصوتية': 'Voice channels',
    'اكتب اسمك': 'Your name',
    'تعديل البروفايل': 'Edit profile',
    'تعديل البروفايل والصورة': 'Edit profile & avatar',
    'صورة البروفايل (64×64)': 'Profile picture (64×64)',
    'إزالة الصورة': 'Remove image',
    'الحالة المخصصة': 'Custom status',
    'اكتب حالتك (مثلاً: يلعب Warzone)': 'Your status (e.g. Playing Warzone)',
    'اختبار المايك': 'Test mic',
    'المايك': 'Microphone',
    'المايك: مطفي 🔇': 'Mic: off 🔇',
    'المايك: ميوت 🔇': 'Mic: muted 🔇',
    'المايك: شغال 🎙️': 'Mic: on 🎙️',
    'السماعة': 'Headphones',
    'السماعة: شغالة 🎧': 'Audio: on 🎧',
    'السماعة: ميوت 🔕': 'Audio: muted 🔕',
    'الإعدادات': 'Settings',
    'قارن الصوت مع العزل وبدونه': 'Compare the sound with and without isolation',
    'عزل الضوضاء': 'Noise isolation',
    'عزل الضوضاء: شغال 🪄': 'Noise isolation: on 🪄',
    'عزل الضوضاء: مطفي 🪄': 'Noise isolation: off 🪄',
    'وضع منتصف الليل 🌙': 'Midnight mode 🌙',
    'القائمة': 'Menu',
    'غير متصل': 'Disconnected',
    'جاري الاتصال...': 'Connecting...',
    'متصل P2P': 'P2P connected',
    'متصل بنجاح ✅': 'Connected ✅',
    'اتصال P2P ⚡': 'Connect P2P ⚡',
    'مشاركة الشاشة': 'Share screen',
    'الشاشة: مطفي 🖥️': 'Screen: off 🖥️',
    'الشاشة: يبث 🔴': 'Screen: live 🔴',
    'أنت تبث الشاشة الآن': 'You are sharing your screen',
    'الجودة': 'Quality',
    'إيقاف': 'Stop',
    'نافذة عائمة': 'Pop-out',
    'لقطة': 'Screenshot',
    'طلب التحكم': 'Request control',
    'التحكم نشط': 'Control active',
    'قفل الماوس': 'Lock mouse',
    '🚫 التحكم: مغلق': '🚫 Control: Off',
    '🎯 اللعبة فقط': '🎯 Game only',
    '🖥️ الجهاز الكامل': '🖥️ Full desktop',
    'صاحبك يطلب التحكم بالكيبورد والماوس': 'Your friend is requesting keyboard & mouse control',
    'سماح (اللعبة)': 'Allow (Game)',
    'الجهاز الكامل': 'Full desktop',
    'رفض': 'Deny',
    'التحكم نشط — Ctrl+Shift+End للإلغاء': 'Control active — Ctrl+Shift+End to stop',
    'تم إرسال طلب التحكم لصاحب البث...': 'Control request sent to streamer...',
    'تم تفعيل التحكم عن بُعد 🎮': 'Remote control enabled 🎮',
    'تم إيقاف التحكم عن بُعد': 'Remote control stopped',
    'اكتب رسالة لصاحبك...': 'Type a message...',
    'إيموجي': 'Emoji',
    'إرسال': 'Send',
    'إغلاق': 'Close',
    'بث الشاشة': 'Screen share',
    'الدقة': 'Resolution',
    'معدل الإطارات (fps)': 'Frame rate (fps)',
    'البت ريت (Mbps)': 'Bitrate (Mbps)',
    'تلقائي': 'Auto',
    'الأوبتيمايزر (وضع الألعاب)': 'Optimizer (game mode)',
    'مشاركة صوت الشاشة (استخدم سماعة رأس)': 'Share screen audio (use headphones)',
    'إلغاء': 'Cancel',
    'ابدأ البث': 'Start streaming',
    'رفع': 'upload',
    'حتى': 'up to',
    ' — جودة عالية جداً، تأكد من سرعة الرفع وقوة الجهاز': ' — very high quality, check your upload speed and PC power',
    'الربط': 'Link',
    'البنق': 'Ping',
    'فقدان الحزم': 'Packet loss',
    'البث': 'Stream',
    'أنت': 'You',
    'في الروم': 'In room',
    'مجهول': 'Unknown',
    'جاري الاتصال بالسيرفر...': 'Connecting to the server...',
    'متصل بالسيرفر ✅': 'Connected to the server ✅',
    'جاري إعادة الاتصال بالسيرفر...': 'Reconnecting to the server...',
    'استلمت طلب اتصال من الروم، جاري الربط...': 'Received a connection request, linking...',
    '✅ تم الاتصال المباشر بنجاح!': '✅ Direct connection established!',
    'انقطع الاتصال المباشر.': 'Direct connection lost.',
    '💬 القناة مفتوحة الآن!': '💬 The channel is open!',
    'ما في رد بالروم. تأكد إن صاحبك داخل نفس اسم الروم.': 'No reply in the room. Make sure your friend joined the same room.',
    'تم كتم السماعة والمايك (Deafen).': 'Headphones and mic muted (Deafen).',
    'تم إعادة تشغيل السماعة.': 'Headphones are back on.',
    'اكتب اسم الروم أولاً!': 'Enter a room name first!',
    'تأكد من صلاحية المايكروفون!': 'Check the microphone permission!',
    'ما انبدأ البث': 'Could not start the stream',
    'تم إيقاف البث والتحكم (زر الطوارئ)': 'Stream & control stopped (panic key)',
    'النافذة العائمة مش مدعومة هون': 'Pop-out is not supported here',
    'إضافة سيرفر': 'Add a server',
    'اسم السيرفر': 'Server name',
    'اللون': 'Color',
    'الانضمام بكود دعوة': 'Join with an invite code',
    'كود الدعوة': 'Invite code',
    'إنشاء': 'Create',
    'انضمام': 'Join',
    'الأيقونة (64×64)': 'Icon (64×64)',
    'رفع صورة': 'Upload image',
    'نسخ الكود': 'Copy code',
    'حفظ': 'Save',
    'حذف السيرفر': 'Delete server',
    'مغادرة السيرفر': 'Leave server',
    'تأكيد الحذف؟': 'Confirm delete?',
    'قناة نصية جديدة': 'New text channel',
    'قناة صوتية جديدة': 'New voice channel',
    'تعديل القناة': 'Edit channel',
    'اسم القناة': 'Channel name',
    'حذف': 'Delete',
    'تم النسخ': 'Copied',
    'اكتب اسم السيرفر': 'Enter a server name',
    'اكتب كود الدعوة': 'Enter an invite code',
    'فقط مالك السيرفر يقدر يعدّل': 'Only the server owner can edit',
    'الصورة كبيرة أو غير صالحة': 'The image is too large or invalid'
};
const norm = (s) => String(s).replace(/\uFE0F/g, '');
const EN2 = Object.assign(Object.create(null), Object.fromEntries(Object.entries(EN).map(([k, v]) => [norm(k), v])));
const PATS = [
    [/^جاري طلب الاتصال في روم (.*)$/, 'Requesting a connection in room $1'],
    [/^(.*) يكتب\.\.\.$/, '$1 is typing...']
];
let lang = localStorage.getItem('chat_lang') === 'en' ? 'en' : 'ar';
const orig = new WeakMap();

function tr(s) {
    if (lang !== 'en' || typeof s !== 'string') return s;
    const k = EN2[norm(s)];
    if (k) return k;
    for (const [re, to] of PATS) if (re.test(s)) return s.replace(re, to);
    const m = /^([^:]+): ([\s\S]*)$/.exec(s);
    return m && EN2[norm(m[1])] ? `${EN2[norm(m[1])]}: ${EN2[norm(m[2])] || m[2]}` : s;
}

function tx(node, ar) {
    node.dataset.ar = ar;
    node.textContent = tr(ar);
}

function applyLang() {
    const en = lang === 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = en ? 'ltr' : 'rtl';
    document.title = tr('شات خفيف ⚡');
    const skip = 'script, [data-ar], #chat-box, #members, #roomName, #topRoom, #textChs, #voiceChs, #dlg, #toasts, #liveInfo, #shareEst, #nerdBody, #vstats, #ping, #typing, #roomCount, #micSelect, #spkSelect, #rcWin, #meStatus';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.nodeValue.trim() || n.parentElement.closest(skip)) continue;
        if (!orig.has(n)) orig.set(n, n.nodeValue);
        const o = orig.get(n);
        n.nodeValue = en ? o.replace(o.trim(), tr(o.trim())) : o;
    }
    document.querySelectorAll('[placeholder], [title], [aria-label]').forEach((e) => {
        ['placeholder', 'title', 'aria-label'].forEach((a) => {
            const k = 'data-ar-' + a;
            if (e.hasAttribute(a) && !e.hasAttribute(k)) e.setAttribute(k, e.getAttribute(a));
            if (e.hasAttribute(k)) e.setAttribute(a, tr(e.getAttribute(k)));
        });
    });
    document.querySelectorAll('[data-ar]').forEach((n) => (n.textContent = tr(n.dataset.ar)));
    $('langBtn').classList.toggle('en', en);
    renderMembers();
    renderRail();
    setTitles(currentRoom);
}

function setLang(l) {
    lang = l;
    localStorage.setItem('chat_lang', l);
    closeDlg();
    applyLang();
}

function initI18n() {
    $('langBtn').onclick = () => setLang(lang === 'en' ? 'ar' : 'en');
    $('langBtn2').onclick = $('langBtn').onclick;
    applyLang();
}

// ===== السيرفرات والقنوات =====
const rd = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; }
};
let servers = rd('chat_servers', []);
let hist = rd('chat_hist', {});
let cur = { s: null, c: null, v: null };
let replay = false;
let saveTimer = null;
const unreadCh = {};
let uid = rd('chat_uid', '');
if (!uid) {
    uid = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('chat_uid', JSON.stringify(uid));
}
const rid = () => Math.random().toString(36).slice(2, 8);
const curSrv = () => servers.find((s) => s.id === cur.s);
const curCh = () => {
    const s = curSrv();
    return s ? s.channels.find((c) => c.id === cur.c) : null;
};
const isOwner = (s) => !!s && s.owner === uid;
const mkChannels = () => [{ id: 'general', type: 'text', name: 'general' }, { id: 'voice', type: 'voice', name: 'Voice' }];
const defaultServer = () => ({ id: 'squad', name: 'squad', color: ACCENTS[0], icon: null, owner: uid, channels: mkChannels() });
const closeDlg = () => ($('dlg').hidden = true);

function saveSrv() {
    localStorage.setItem('chat_servers', JSON.stringify(servers));
    const h = {};
    for (const k in hist) h[k] = hist[k].slice(-150);
    localStorage.setItem('chat_hist', JSON.stringify(h));
}

function setTitles(room) {
    const s = curSrv();
    const c = curCh();
    $('roomName').textContent = s ? s.name : room || '—';
    $('topRoom').textContent = c ? c.name : room || '—';
}

function renderRail() {
    const items = [el('div', 'rbtn logo', '⚡'), el('div', 'rsep')];
    servers.forEach((s) => {
        const b = el('button', s.id === cur.s ? 'rbtn on' : 'rbtn', s.icon ? '' : initial(s.name));
        b.title = s.name;
        b.style.setProperty('--c', s.color);
        if (s.icon) b.style.background = `url(${s.icon}) center/cover`;
        b.onclick = () => {
            selectServer(s.id);
            appEl.classList.remove('open');
        };
        items.push(b);
    });
    const add = el('button', 'rbtn add', '+');
    add.title = tr('إضافة سيرفر');
    add.onclick = openServerDlg;
    const gear = el('button', 'rbtn gear');
    gear.innerHTML = '<svg class="ic"><use href="#i-tune"/></svg>';
    gear.title = tr('الإعدادات');
    gear.onclick = () => $('settingsBtn').click();
    $('rail').replaceChildren(...items, add, gear);
}

const memberNames = () => {
    const n = roomMembers.map((m) => ({
        n: m.id === myId ? getMyName() : m.name || tr('مجهول'),
        sp: m.id === myId ? speaking : !!(peer && peer.id === m.id && peer.speaking),
        av: m.id === myId ? myAvatar : (peer && peer.id === m.id ? peer.avatar : '')
    }));
    return n.length ? n : [{ n: getMyName(), sp: speaking, av: myAvatar }];
};

function renderChannels() {
    const s = curSrv();
    ['text', 'voice'].forEach((type) => {
        const items = [];
        (s ? s.channels : []).filter((c) => c.type === type).forEach((c) => {
            const on = c.id === (type === 'text' ? cur.c : cur.v);
            const li = el('li', 'ch' + (on ? ' on' : '') + (unreadCh[`${cur.s}:${c.id}`] ? ' unread' : ''));
            li.append(el('span', '', type === 'text' ? '#' : '🔊'), el('span', 'cn', c.name));
            if (isOwner(s)) {
                const ed = el('button', 'mini', '✎');
                ed.onclick = (e) => {
                    e.stopPropagation();
                    openChDlg(type, c);
                };
                li.append(ed);
            }
            li.onclick = () => {
                if (type === 'text') {
                    cur.c = c.id;
                    s.last = c.id;
                    showChannel();
                } else joinVoice(c);
            };
            items.push(li);
            if (on && type === 'voice') {
                memberNames().forEach(({ n, sp, av }) => {
                    const m = el('li', sp ? 'vm speaking' : 'vm');
                    const a = el('div', 'avatar');
                    setAvatarNode(a, n, av);
                    m.append(a, el('span', '', n));
                    items.push(m);
                });
            }
        });
        $(type + 'Chs').replaceChildren(...items);
    });
}

function showChannel() {
    const k = `${cur.s}:${cur.c}`;
    delete unreadCh[k];
    lastMsg = { s: '', t: 0 };
    replay = true;
    chatBox.replaceChildren();
    (hist[k] || []).forEach((m) => addMsg(m.s, m.t, m.m, k, m.ts));
    replay = false;
    setTitles(currentRoom);
    renderChannels();
}

function selectServer(id) {
    const s = servers.find((x) => x.id === id);
    if (!s) return;
    const text = s.channels.find((c) => c.id === s.last && c.type === 'text') || s.channels.find((c) => c.type === 'text');
    cur = { s: id, c: text ? text.id : null, v: null };
    localStorage.setItem('chat_cur', id);
    roomInput.value = id;
    joinRoom();
    showChannel();
}

function joinVoice(c) {
    cur.v = c.id;
    renderChannels();
    if (!peerConnection || peerConnection.connectionState !== 'connected') startBtn.click();
}

function syncServer() {
    const s = curSrv();
    if (isOwner(s)) dcSend({ t: 'SYNC_SERVER', server: s });
}

function upsertServer(d) {
    if (!d || typeof d.id !== 'string') return;
    const id = d.id.slice(0, 20);
    const clean = {
        name: String(d.name || id).slice(0, 30),
        color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : ACCENTS[0],
        icon: /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{1,8000}$/.test(d.icon || '') ? d.icon : null,
        channels: (Array.isArray(d.channels) ? d.channels : []).slice(0, 30).map((c) => ({
            id: String(c.id).slice(0, 12),
            type: c.type === 'voice' ? 'voice' : 'text',
            name: String(c.name).slice(0, 30)
        }))
    };
    if (!clean.channels.length) clean.channels = mkChannels();
    const s = servers.find((x) => x.id === id);
    if (s) Object.assign(s, clean);
    else servers.push({ id, owner: '', ...clean });
    saveSrv();
    renderRail();
    renderChannels();
    setTitles(currentRoom);
}

function openDlg(title, rows, actions) {
    const x = el('button', 'x', '✕');
    x.onclick = closeDlg;
    const acts = el('div', 'acts');
    actions.forEach(([label, fn, cls]) => {
        const b = el('button', cls || 'chip', tr(label));
        b.onclick = fn;
        acts.append(b);
    });
    const card = el('div', 'card');
    card.append(x, el('h3', '', tr(title)));
    rows.forEach(([label, node]) => card.append(el('div', 'lab', tr(label)), node));
    card.append(acts);
    $('dlg').replaceChildren(card);
    $('dlg').hidden = false;
    const first = card.querySelector('input');
    if (first) first.focus();
}

function inp(v = '', ph = '') {
    const i = el('input', 'fld');
    i.value = v;
    i.placeholder = tr(ph);
    return i;
}

function colorRow(sel) {
    const d = el('div', 'sws');
    ACCENTS.forEach((c) => {
        const i = el('i', c === sel.v ? 'on' : '');
        i.style.background = c;
        i.onclick = () => {
            sel.v = c;
            d.querySelectorAll('i').forEach((n) => n.classList.toggle('on', n === i));
        };
        d.append(i);
    });
    return d;
}

function compressImg(file, size = 64) {
    return new Promise((ok, no) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = c.height = size;
            const m = Math.min(img.width, img.height);
            c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
            let q = 0.85;
            let d = c.toDataURL('image/jpeg', q);
            while (d.length > 6800 && q > 0.2) d = c.toDataURL('image/jpeg', (q -= 0.1));
            URL.revokeObjectURL(img.src);
            if (d.length > 6800) no();
            else ok(d);
        };
        img.onerror = no;
        img.src = URL.createObjectURL(file);
    });
}

function openServerDlg() {
    const name = inp('', 'اسم السيرفر');
    const code = inp('', 'كود الدعوة');
    const sel = { v: ACCENTS[0] };
    openDlg('إضافة سيرفر', [['اسم السيرفر', name], ['اللون', colorRow(sel)], ['الانضمام بكود دعوة', code]], [
        ['إنشاء', () => {
            const n = name.value.trim();
            if (!n) return toast('اكتب اسم السيرفر');
            const s = { id: rid(), name: n.slice(0, 30), color: sel.v, icon: null, owner: uid, channels: mkChannels() };
            servers.push(s);
            saveSrv();
            closeDlg();
            selectServer(s.id);
        }, 'cta'],
        ['انضمام', () => {
            const id = code.value.trim().toLowerCase().slice(0, 20);
            if (!id) return toast('اكتب كود الدعوة');
            if (!servers.some((x) => x.id === id)) servers.push({ id, name: id, color: colorOf(id), icon: null, owner: '', channels: mkChannels() });
            saveSrv();
            closeDlg();
            selectServer(id);
        }]
    ]);
}

function delServer(s) {
    servers = servers.filter((x) => x.id !== s.id);
    if (!servers.length) servers.push(defaultServer());
    saveSrv();
    closeDlg();
    selectServer(servers[0].id);
}

const armDelete = (e, fn) => {
    if (!e.target.dataset.arm) {
        e.target.dataset.arm = 1;
        e.target.textContent = tr('تأكيد الحذف؟');
        return;
    }
    fn();
};

function openSrvSettings() {
    const s = curSrv();
    if (!s) return;
    const own = isOwner(s);
    const name = inp(s.name, 'اسم السيرفر');
    name.disabled = !own;
    const code = inp(s.id);
    code.readOnly = true;
    const pick = el('button', 'chip', tr('رفع صورة'));
    pick.disabled = !own;
    pick.onclick = () => {
        const f = el('input');
        f.type = 'file';
        f.accept = 'image/*';
        f.onchange = async () => {
            try {
                s.icon = await compressImg(f.files[0]);
                pick.textContent = tr('تم ✓');
            } catch {
                toast('الصورة كبيرة أو غير صالحة');
            }
        };
        f.click();
    };
    const acts = [['نسخ الكود', () => {
        navigator.clipboard.writeText(s.id).catch(() => {});
        toast('تم النسخ');
    }]];
    if (own) {
        acts.push(['حفظ', () => {
            s.name = name.value.trim().slice(0, 30) || s.name;
            saveSrv();
            closeDlg();
            renderRail();
            setTitles(currentRoom);
            syncServer();
        }, 'cta']);
        acts.push(['حذف السيرفر', (e) => armDelete(e, () => delServer(s)), 'chip del']);
    } else {
        acts.push(['مغادرة السيرفر', (e) => armDelete(e, () => delServer(s)), 'chip del']);
    }
    openDlg('إعدادات السيرفر', [['اسم السيرفر', name], ['الأيقونة (64×64)', pick], ['كود الدعوة', code]], acts);
}

function openChDlg(type, c) {
    const s = curSrv();
    const name = inp(c ? c.name : '', 'اسم القناة');
    const done = () => {
        saveSrv();
        closeDlg();
        renderChannels();
        setTitles(currentRoom);
        syncServer();
    };
    const acts = [[c ? 'حفظ' : 'إنشاء', () => {
        const n = name.value.trim().slice(0, 30);
        if (!n) return;
        if (c) c.name = n;
        else s.channels.push({ id: rid(), type, name: n });
        done();
    }, 'cta']];
    if (c) {
        acts.push(['حذف', (e) => armDelete(e, () => {
            s.channels = s.channels.filter((x) => x.id !== c.id);
            if (cur.c === c.id) {
                const t0 = s.channels.find((x) => x.type === 'text');
                cur.c = t0 ? t0.id : null;
                showChannel();
            }
            done();
        }), 'chip del']);
    }
    openDlg(c ? 'تعديل القناة' : type === 'text' ? 'قناة نصية جديدة' : 'قناة صوتية جديدة', [['اسم القناة', name]], acts);
}

function initServers() {
    if (!servers.length) servers.push(defaultServer());
    const s = servers.find((x) => x.id === localStorage.getItem('chat_cur')) || servers[0];
    const text = s.channels.find((c) => c.id === s.last && c.type === 'text') || s.channels.find((c) => c.type === 'text');
    cur = { s: s.id, c: text ? text.id : null, v: null };
    roomInput.value = s.id;
    $('srvBtn').onclick = openSrvSettings;
    $('addText').onclick = () => (isOwner(curSrv()) ? openChDlg('text') : toast('فقط مالك السيرفر يقدر يعدّل'));
    $('addVoice').onclick = () => (isOwner(curSrv()) ? openChDlg('voice') : toast('فقط مالك السيرفر يقدر يعدّل'));
    $('dlg').onclick = (e) => { if (e.target.id === 'dlg') closeDlg(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDlg(); });
    renderRail();
    showChannel();
}

let notifOn = true;
function initBell() {
    $('bellBtn').onclick = () => {
        notifOn = !notifOn;
        $('bellBtn').classList.toggle('danger', !notifOn);
    };
}

async function loadIceConfiguration() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(TURN_API_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error();
        const meteredServers = await response.json();
        return { iceServers: Array.isArray(meteredServers) ? [...fallbackIceServers, ...meteredServers] : fallbackIceServers };
    } catch {
        return { iceServers: fallbackIceServers };
    }
}
const iceConfigPromise = loadIceConfiguration();

// ===== 1. الاتصال بالسيرفر ونظام الرومات =====
function sendJoin() {
    if (ws && ws.readyState === WebSocket.OPEN && currentRoom) {
        ws.send(JSON.stringify({ type: 'join', room: currentRoom, name: usernameInput.value.trim() }));
    }
}

function joinRoom() {
    const room = roomInput.value.trim();
    if (!room) return toast('اكتب اسم الروم أولاً!');
    localStorage.setItem('chat_room', room);
    if (room !== currentRoom) {
        roomMembers = [];
        lastCount = 0;
    }
    currentRoom = room;
    if (!rooms.includes(room)) rooms = [...rooms, room].slice(-12);
    localStorage.setItem('chat_rooms', JSON.stringify(rooms));
    renderRail();
    setTitles(room);
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendJoin();
        sys(`دخلت روم: [${currentRoom}] ✅`, '#4ade80');
    }
    renderMembers();
}

joinRoomBtn.onclick = () => {
    joinRoom();
    appEl.classList.remove('open');
};

copyBtn.onclick = async () => {
    try {
        await navigator.clipboard.writeText(currentRoom || roomInput.value.trim());
        tx(copyBtn, 'تم ✓');
    } catch {
        tx(copyBtn, '✗');
    }
    setTimeout(() => (tx(copyBtn, 'نسخ الدعوة')), 1200);
};

$('menuBtn').onclick = () => appEl.classList.toggle('open');
$('backdrop').onclick = () => appEl.classList.remove('open');

function connectWebSocket() {
    sys('جاري الاتصال بالسيرفر...');
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
        sys('متصل بالسيرفر ✅', '#4ade80');
        joinRoom();
    };

    ws.onclose = () => {
        lastCount = 0;
        sys('جاري إعادة الاتصال بالسيرفر...', '#fbbf24');
        setTimeout(connectWebSocket, 4000);
    };

    ws.onmessage = async (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }

        try {
            if (data.type === 'hello') {
                if (data.id !== myId) {
                    myId = data.id;
                    sendHello();
                }
                renderMembers();
            } else if (data.type === 'room-info') {
                roomMembers = data.members || [];
                if (lastCount && data.count > lastCount) sfx('join');
                lastCount = data.count;
                renderMembers();
            } else if (data.offer) {
                sys('استلمت طلب اتصال من الروم، جاري الربط...', '#38bdf8');
                if (!peerConnection || ['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState)) {
                    pendingCandidates = [];
                    await createPeerConnection();
                }
                startBtn.disabled = true;
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                await flushPendingCandidates();
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                sendSignal({ answer });
            } else if (data.answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                await flushPendingCandidates();
            } else if (data.iceCandidate) {
                if (peerConnection && peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.iceCandidate));
                } else {
                    pendingCandidates.push(data.iceCandidate);
                }
            } else if (data.stopVideo) {
                remoteVideo.srcObject = null;
                videoContainer.style.display = 'none';
                clearInterval(vsTimer);
                streamAudioBtn.hidden = true;
                setViewerRc(false);
            }
        } catch (err) {
            console.error(err);
        }
    };
}

async function flushPendingCandidates() {
    while (pendingCandidates.length > 0 && peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(pendingCandidates.shift()));
    }
}

function sendSignal(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        return true;
    }
    return false;
}

// ===== 2. اتصال P2P =====
function addScreenTracks() {
    const v = screenStream.getVideoTracks()[0];
    const a = screenStream.getAudioTracks()[0];
    if (v) screenSender = peerConnection.addTrack(v, screenStream);
    if (a) screenAudioSender = peerConnection.addTrack(a, screenStream);
    applyScreenParams();
    setTimeout(applyScreenParams, 1500);
}

async function createPeerConnection() {
    if (peerConnection) {
        peerConnection.onconnectionstatechange = null;
        peerConnection.onicecandidate = null;
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(await iceConfigPromise);

    if (micOut) {
        const track = micOut.getAudioTracks()[0];
        if (track) micSender = peerConnection.addTrack(track, micOut);
    }
    if (screenStream) addScreenTracks();

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) sendSignal({ iceCandidate: e.candidate });
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (state === 'connecting') {
            setLink('جاري الاتصال...', 'wait');
        } else if (state === 'connected') {
            clearTimeout(connectTimeout);
            setLink('متصل P2P', 'online');
            tx(lbl(startBtn), 'متصل بنجاح ✅');
            startBtn.classList.add('active');
            startBtn.disabled = true;
            sys('✅ تم الاتصال المباشر بنجاح!', '#4ade80');
            sfx('connect');
        } else if (state === 'failed' || state === 'disconnected') {
            setLink('غير متصل', '');
            pingEl.textContent = '— ms';
            pingEl.className = 'badge';
            tx(lbl(startBtn), 'اتصال P2P ⚡');
            startBtn.classList.remove('active');
            startBtn.disabled = false;
            sys('انقطع الاتصال المباشر.', '#f87171');
            peer = null;
            setViewerRc(false);
            renderMembers();
        }
    };

    peerConnection.ontrack = (e) => {
        const stream = e.streams[0];
        if (e.track.kind === 'video' || stream.getVideoTracks().length) {
            remoteVideo.srcObject = stream;
            remoteVideo.muted = isDeafened || streamMuted;
            remoteVideo.volume = Number(streamVolSlider.value);
            videoContainer.style.display = 'flex';
            startVideoStats();
            streamAudioBtn.hidden = !stream.getAudioTracks().length;
        } else {
            setupRemoteChain(stream);
            applyRemoteAudio();
            remoteAudio.srcObject = stream;
        }
    };

    peerConnection.ondatachannel = (e) => {
        dataChannel = e.channel;
        setupDataChannel();
    };
}

function setupDataChannel() {
    const ch = dataChannel;
    ch.onopen = () => {
        clearTimeout(connectTimeout);
        sys('💬 القناة مفتوحة الآن!', '#4ade80');
        sendHello();
    };
    ch.onclose = () => {
        if (dataChannel === ch) {
            peer = null;
            setViewerRc(false);
            renderMembers();
        }
    };
    ch.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return addMsg('صاحبك', e.data, false); }
        if (msg.t === 'hello') {
            peer = {
                id: msg.id,
                name: msg.name,
                avatar: /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{1,8000}$/.test(msg.avatar || '') ? msg.avatar : '',
                status: String(msg.status || '').slice(0, 40),
                muted: true,
                deaf: false,
                speaking: false,
                typing: !!msg.typing
            };
            renderMembers();
        } else if (msg.t === 'state') {
            if (peer) Object.assign(peer, { muted: msg.muted, deaf: msg.deaf, speaking: msg.speaking });
            renderMembers();
        } else if (msg.t === 'SYNC_SERVER') {
            upsertServer(msg.server);
        } else if (msg.t === 'RC_REQ') {
            if (!screenStream) return;
            if (rcHostMode !== 'off') {
                rcHostApproved = true;
                dcSend({ t: 'RC_GRANT', ok: true, mode: rcHostMode });
            } else {
                $('rcAsk').hidden = false;
            }
        } else if (msg.t === 'RC_GRANT') {
            if (msg.ok) setViewerRc(true);
        } else if (msg.t === 'RC_STOP') {
            if (rcActive) {
                setViewerRc(false);
                toast('تم إيقاف التحكم عن بُعد');
            }
            rcHostApproved = false;
            $('rcAsk').hidden = true;
        } else if (msg.t === 'RC_IN') {
            if (tauriInvoke && screenStream && rcHostMode !== 'off' && rcHostApproved && msg.p) {
                const hwnd = rcHostMode === 'game' ? (Number($('rcWin').value) || null) : null;
                tauriInvoke('remote_input', { p: { ...msg.p, mode: rcHostMode, hwnd } }).catch(() => {});
            }
        } else if (msg.t === 'typing') {
            showTyping();
        } else if (msg.t === 'ping') {
            dcSend({ t: 'pong', ts: msg.ts });
        } else if (msg.t === 'pong') {
            showPing(Date.now() - msg.ts);
        } else {
            addMsg(msg.sender || 'صاحبك', msg.text, false, msg.srv && msg.ch ? `${msg.srv}:${msg.ch}` : undefined);
        }
    };
}

async function updateConnection() {
    if (peerConnection && dataChannel && dataChannel.readyState === 'open') {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ offer });
    }
}

startBtn.onclick = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    startBtn.disabled = true;
    sys(`جاري طلب الاتصال في روم [${currentRoom}]...`, '#38bdf8');
    pendingCandidates = [];
    await createPeerConnection();
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal({ offer });

    clearTimeout(connectTimeout);
    connectTimeout = setTimeout(() => {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            startBtn.disabled = false;
            sys('ما في رد بالروم. تأكد إن صاحبك داخل نفس اسم الروم.', '#fbbf24');
        }
    }, 12000);
};

// ===== 3. المايك + السماعة =====
function updateMicUI() {
    tx(lbl(micBtn), isMicMuted ? 'المايك: ميوت 🔇' : 'المايك: شغال 🎙️');
    micBtn.classList.toggle('danger', isMicMuted);
    micBtn.classList.toggle('active', !isMicMuted);
    renderMembers();
    sendState();
}

async function openMicStream() {
    try {
        const devId = localStorage.getItem('chat_mic');
        const audioCfg = { echoCancellation: true, noiseSuppression: noiseIsolation, autoGainControl: noiseIsolation };
        if (devId) audioCfg.deviceId = { ideal: devId };
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioCfg });
        isMicMuted = false;
        setupMicChain(micStream);
        const track = micOut.getAudioTracks()[0];
        if (peerConnection && peerConnection.connectionState === 'connected') {
            if (micSender) await micSender.replaceTrack(track);
            else {
                micSender = peerConnection.addTrack(track, micOut);
                await updateConnection();
            }
        }
        updateMicUI();
        refreshDevices();
        sfx('unmute');
    } catch {
        toast('تأكد من صلاحية المايكروفون!');
    }
}

micBtn.onclick = async () => {
    if (isDeafened) return;
    if (!micStream) {
        await openMicStream();
    } else {
        isMicMuted = !isMicMuted;
        micStream.getAudioTracks().forEach((t) => (t.enabled = !isMicMuted));
        updateMicUI();
        sfx(isMicMuted ? 'mute' : 'unmute');
    }
};

deafenBtn.onclick = () => {
    isDeafened = !isDeafened;
    applyRemoteAudio();
    remoteVideo.muted = isDeafened || streamMuted;

    if (isDeafened) {
        tx(lbl(deafenBtn), 'السماعة: ميوت 🔕');
        deafenBtn.classList.add('danger');
        micStateBeforeDeafen = isMicMuted;
        if (!isMicMuted && micStream) {
            isMicMuted = true;
            micStream.getAudioTracks().forEach((t) => (t.enabled = false));
            updateMicUI();
        }
        sys('تم كتم السماعة والمايك (Deafen).');
    } else {
        tx(lbl(deafenBtn), 'السماعة: شغالة 🎧');
        deafenBtn.classList.remove('danger');
        if (!micStateBeforeDeafen && micStream) {
            isMicMuted = false;
            micStream.getAudioTracks().forEach((t) => (t.enabled = true));
            updateMicUI();
        }
        sys('تم إعادة تشغيل السماعة.');
    }
    renderMembers();
    sendState();
    sfx(isDeafened ? 'deafen' : 'undeafen');
};

volumeSlider.oninput = () => applyRemoteAudio();
streamVolSlider.oninput = () => {
    remoteVideo.volume = Number(streamVolSlider.value);
};

// ===== 4. بث الشاشة =====
async function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        if (peerConnection) [screenSender, screenAudioSender].forEach((s) => s && peerConnection.removeTrack(s));
        screenStream = null;
        screenSender = null;
        screenAudioSender = null;
        tx(lbl(screenBtn), 'الشاشة: مطفي 🖥️');
        screenBtn.classList.remove('active');
        showLive(false);
        sendSignal({ stopVideo: true });
        await updateConnection();
    }
}

async function startShare() {
    if (!screenStream) {
        try {
            const c = shareCfg;
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { ideal: c.w }, height: { ideal: c.h }, frameRate: { ideal: c.fps, max: c.fps } },
                audio: c.audio
            });
            const track = screenStream.getVideoTracks()[0];
            track.contentHint = c.opt ? 'motion' : 'detail';
            if (peerConnection && peerConnection.connectionState === 'connected') {
                addScreenTracks();
                await updateConnection();
            }
            track.onended = () => stopScreenShare();
            tx(lbl(screenBtn), 'الشاشة: يبث 🔴');
            screenBtn.classList.add('active');
            showLive(true);
        } catch (e) {
            if (e && e.name !== 'NotAllowedError') toast('ما انبدأ البث');
        }
    }
}

screenBtn.onclick = () => (screenStream ? stopScreenShare() : openShare());

streamAudioBtn.onclick = () => {
    streamMuted = !streamMuted;
    remoteVideo.muted = isDeafened || streamMuted;
    streamAudioBtn.classList.toggle('danger', streamMuted);
};

// ===== 5. الشات =====
function sendMessage() {
    const text = msgInput.value.trim();
    if (dataChannel && dataChannel.readyState === 'open' && text !== '') {
        const sender = getMyName();
        dataChannel.send(JSON.stringify({ sender, text, srv: cur.s, ch: cur.c }));
        addMsg(sender, text, true);
        msgInput.value = '';
    }
}

sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

renderMembers();
renderRail();
initUI();
initShareUI();
initServers();
initI18n();
initBell();
connectWebSocket();
