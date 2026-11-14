const SERVER_URL = 'wss://my-chat-server-cklh.onrender.com';
const TURN_API_URL = 'https://myapp222.metered.live/api/v1/turn/credentials?apiKey=xdOg3DmVOkph7BbC-8Gocxvv3ra70YJYCbhFA52FTAIB-cqA';

const fallbackIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

const VAD_THRESHOLD = 0.03; // حساسية كشف الصوت (صغّرها لو المايك ضعيف)
const VAD_HOLD_MS = 350;    // كم تبقى الحلقة الخضراء بعد ما توقف عن الكلام

// إعدادات الضاغط الديناميكي: [threshold dB, knee dB, ratio, attack s, release s]
const COMP_TX = [-14, 10, 6, 0.003, 0.2]; // المايك: يمنع تشويش الأصوات العالية المفاجئة
const COMP_RX = [-22, 20, 3, 0.01, 0.25]; // صوت صاحبك: يوازن الارتفاع والانخفاض

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
let micOut = null; // المايك بعد الفلاتر (هذا اللي بينرسل للـ RTCPeerConnection)
let tx = null; // مسار المايك الصادر
let rx = null; // مسار صوت صاحبك الوارد
let noiseIsolation = true; // عزل الضوضاء (شغال افتراضياً)
let pendingCandidates = [];
let connectTimeout = null;
let myId = Math.random().toString(36).slice(2, 8); // يتبدّل برقم السيرفر أول ما يتصل
let roomMembers = [];
let lastCount = 0;
let peer = null; // حالة الطرف الثاني (من الـ DataChannel)
let speaking = false;
let actx = null;
let vadTimer = null;
let lastLoud = 0;

const $ = (id) => document.getElementById(id);
const chatBox = $('chat-box');
const msgInput = $('msgInput');
const sendBtn = $('sendBtn');
const startBtn = $('startBtn');
const micBtn = $('micBtn');
const deafenBtn = $('deafenBtn');
const screenBtn = $('screenBtn');
const volumeSlider = $('volumeSlider');
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

// حفظ واسترجاع الاسم والروم تلقائياً
usernameInput.value = localStorage.getItem('chat_user') || '';
roomInput.value = localStorage.getItem('chat_room') || 'squad';
usernameInput.addEventListener('input', () => localStorage.setItem('chat_user', usernameInput.value));
usernameInput.addEventListener('change', () => {
    sendJoin(); // السيرفر يحدّث اسمك بقائمة المتواجدين
    sendHello(); // والطرف الثاني يحدّثه عبر الـ DataChannel
    renderMembers();
});

function getMyName() {
    return usernameInput.value.trim() || 'أنت';
}

// ===== 0. واجهة: رسائل + قائمة المتواجدين =====
function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}
const initial = (s) => (String(s || '?').trim().charAt(0) || '?').toUpperCase();

function pushChat(node) {
    chatBox.appendChild(node);
    while (chatBox.childElementCount > 300) chatBox.firstElementChild.remove(); // يحافظ على الرام
    chatBox.scrollTop = chatBox.scrollHeight;
}

function sys(text, color = '#949ba4') {
    const p = el('p', 'sys', text);
    p.style.color = color;
    pushChat(p);
}

function addMsg(sender, text, mine) {
    const head = el('div', 'head');
    head.append(el('b', '', sender), el('time', '', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    const bubble = el('div', 'bubble');
    bubble.append(head, el('div', 'text', text));
    const row = el('div', mine ? 'msg me' : 'msg');
    row.append(el('div', 'avatar', initial(sender)), bubble);
    pushChat(row);
}

function setLink(text, cls) {
    linkText.textContent = text;
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
    membersEl.replaceChildren(...list.map((m) => {
        const isMe = m.id === myId;
        const p = !isMe && peer && peer.id === m.id ? peer : null;
        const st = isMe ? { muted: isMicMuted, deaf: isDeafened, speaking } : p || {};
        const name = isMe ? getMyName() : m.name || (p && p.name) || 'مجهول';
        const info = el('div', 'info');
        info.append(el('span', 'nm', name), el('small', '', isMe ? 'أنت' : p ? 'متصل P2P' : 'في الروم'));
        const li = el('li', st.speaking ? 'member speaking' : 'member');
        li.append(el('div', 'avatar', initial(name)), info, el('span', '', st.deaf ? '🔕' : st.muted ? '🔇' : ''));
        return li;
    }));
}

// ===== مؤثرات صوتية (Web Audio بدون ملفات) =====
function getCtx() {
    if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        actx.onstatechange = applyRemoteAudio; // لو الصوت انفتح متأخر (بعد أول ضغطة) يتحوّل للمسار المُصفّى
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
}
document.addEventListener('pointerdown', getCtx, { once: true }); // المتصفح بيسمح بالصوت بعد أول ضغطة

const SFX = { join: [523, 784], connect: [440, 660, 880], mute: [330], unmute: [660], deafen: [330, 247], undeafen: [247, 330] };
function sfx(name) {
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

// ===== كشف التحدث (VAD) + مزامنة الحالة عبر DataChannel =====
function startVAD(node) { // node = الصوت المُصفّى المُرسل
    clearInterval(vadTimer);
    const ctx = getCtx();
    const analyser = ctx.createAnalyser();
    const buf = new Uint8Array(512);
    analyser.fftSize = 512;
    node.connect(analyser); // للتحليل فقط، مش متوصل بالسماعات
    vadTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const now = performance.now();
        if (!isMicMuted && Math.sqrt(sum / buf.length) > VAD_THRESHOLD) lastLoud = now;
        setSpeaking(now - lastLoud < VAD_HOLD_MS);
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
    dcSend({ t: 'hello', id: myId, name: usernameInput.value.trim() });
    sendState();
}
setInterval(() => dcSend({ t: 'ping', ts: Date.now() }), 3000); // قياس البنق عبر القناة

// ===== عزل الضوضاء وتحسين الجودة (Web Audio) =====
function makeComp(ctx, [threshold, knee, ratio, attack, release]) {
    const n = ctx.createDynamicsCompressor();
    n.threshold.value = threshold;
    n.knee.value = knee;
    n.ratio.value = ratio;
    n.attack.value = attack;
    n.release.value = release;
    return n;
}

// الصادر: مايك > highpass 85Hz > ضاغط > (يُرسل للـ RTCPeerConnection + يقرأ منه الـ VAD)
function setupMicChain(stream) {
    const ctx = getCtx();
    const src = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85; // يقص طنين المراوح والمكيفات
    const comp = makeComp(ctx, COMP_TX);
    const proc = ctx.createGain(); // المسار المُصفّى
    const raw = ctx.createGain(); // المسار الخام (لما العزل يكون مطفي، للمقارنة)
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
    mix.connect(dest); // مش متوصل بالسماعات أبداً، فما في صدى من صوتك
    tx = { proc, raw };
    micOut = dest.stream;
    startVAD(mix); // الـ VAD يقرأ من نفس الصوت المُرسل (المُصفّى) فما يضوي من صوت المكيف
}

// الوارد: صوت صاحبك > highpass 100Hz > lowpass 7500Hz > ضاغط > gain (Deafen + Volume) > السماعات
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
        hp.frequency.value = 100; // يقص المكيف والضجيج المنخفض
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 7500; // يقص الصفير والتشويش الحاد
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
        rx = null; // لو فشل: يشتغل الصوت العادي من عنصر الـ audio
    }
}

// مصدر صوت واحد بس يشتغل بكل لحظة (المُصفّى أو العادي) عشان ما يصير صدى مزدوج
function applyRemoteAudio() {
    const vol = Number(volumeSlider.value);
    const viaChain = noiseIsolation && !!rx && !!actx && actx.state === 'running';
    remoteAudio.muted = viaChain || isDeafened;
    remoteAudio.volume = vol;
    if (rx) rx.out.gain.setTargetAtTime(viaChain && !isDeafened ? vol : 0, actx.currentTime, 0.02);
}

function applyIsolation() {
    if (tx) {
        const t = actx.currentTime;
        tx.proc.gain.setTargetAtTime(noiseIsolation ? 1 : 0, t, 0.02);
        tx.raw.gain.setTargetAtTime(noiseIsolation ? 0 : 1, t, 0.02);
    }
    const track = micStream && micStream.getAudioTracks()[0];
    if (track) track.applyConstraints({ echoCancellation: true, noiseSuppression: noiseIsolation, autoGainControl: noiseIsolation }).catch(() => {});
    applyRemoteAudio();
}

nsBtn.onclick = () => {
    noiseIsolation = !noiseIsolation;
    nsBtn.textContent = noiseIsolation ? 'عزل الضوضاء: شغال 🪄' : 'عزل الضوضاء: مطفي 🪄';
    nsBtn.classList.toggle('active', noiseIsolation);
    applyIsolation();
    sys(`عزل الضوضاء: ${noiseIsolation ? 'شغال' : 'مطفي'}`);
};

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
    if (!room) return alert('اكتب اسم الروم أولاً!');
    localStorage.setItem('chat_room', room);
    if (room !== currentRoom) {
        roomMembers = [];
        lastCount = 0;
    }
    currentRoom = room;
    $('roomName').textContent = room;
    $('topRoom').textContent = room;
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
        copyBtn.textContent = 'تم ✓';
    } catch {
        copyBtn.textContent = '✗';
    }
    setTimeout(() => (copyBtn.textContent = 'نسخ'), 1200);
};

$('menuBtn').onclick = () => appEl.classList.toggle('open');
$('backdrop').onclick = () => appEl.classList.remove('open');

function connectWebSocket() {
    sys('جاري الاتصال بالسيرفر...');
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
        sys('متصل بالسيرفر ✅', '#4ade80');
        joinRoom(); // دخول الروم تلقائياً فور الاتصال
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
                    sendHello(); // الطرف الثاني يعرف رقمك الجديد
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
                streamAudioBtn.hidden = true;
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
    const a = screenStream.getAudioTracks()[0]; // صوت البث (لو المستخدم فعّله)
    if (v) screenSender = peerConnection.addTrack(v, screenStream);
    if (a) screenAudioSender = peerConnection.addTrack(a, screenStream);
}

async function createPeerConnection() {
    if (peerConnection) {
        peerConnection.onconnectionstatechange = null;
        peerConnection.onicecandidate = null;
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(await iceConfigPromise);

    if (micOut) {
        const track = micOut.getAudioTracks()[0]; // المايك المُصفّى (مش الخام)
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
            startBtn.textContent = 'متصل بنجاح ✅';
            startBtn.classList.add('active');
            startBtn.disabled = true;
            sys('✅ تم الاتصال المباشر بنجاح!', '#4ade80');
            sfx('connect');
        } else if (state === 'failed' || state === 'disconnected') {
            setLink('غير متصل', '');
            pingEl.textContent = '— ms';
            pingEl.className = 'badge';
            startBtn.textContent = 'اتصال P2P ⚡';
            startBtn.classList.remove('active');
            startBtn.disabled = false;
            sys('انقطع الاتصال المباشر.', '#f87171');
            peer = null;
            renderMembers();
        }
    };

    peerConnection.ontrack = (e) => {
        const stream = e.streams[0];
        if (e.track.kind === 'video' || stream.getVideoTracks().length) {
            remoteVideo.srcObject = stream; // البث (وصوته لو موجود) يشتغل من عنصر الفيديو
            remoteVideo.muted = isDeafened || streamMuted;
            videoContainer.style.display = 'flex';
            streamAudioBtn.hidden = !stream.getAudioTracks().length;
        } else {
            setupRemoteChain(stream); // يمرّر الصوت الوارد بفلاتر قبل السماعة
            applyRemoteAudio();
            remoteAudio.srcObject = stream; // صوت المايك
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
            renderMembers();
        }
    };
    ch.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return addMsg('صاحبك', e.data, false); }
        if (msg.t === 'hello') {
            peer = { id: msg.id, name: msg.name, muted: true, deaf: false, speaking: false };
            renderMembers();
        } else if (msg.t === 'state') {
            if (peer) Object.assign(peer, { muted: msg.muted, deaf: msg.deaf, speaking: msg.speaking });
            renderMembers();
        } else if (msg.t === 'ping') {
            dcSend({ t: 'pong', ts: msg.ts });
        } else if (msg.t === 'pong') {
            showPing(Date.now() - msg.ts);
        } else {
            addMsg(msg.sender || 'صاحبك', msg.text, false);
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

// ===== 3. المايك + ميوت السماعة (Deafen) =====
function updateMicUI() {
    micBtn.textContent = isMicMuted ? 'المايك: ميوت 🔇' : 'المايك: شغال 🎙️';
    micBtn.classList.toggle('danger', isMicMuted);
    micBtn.classList.toggle('active', !isMicMuted);
    renderMembers();
    sendState();
}

micBtn.onclick = async () => {
    if (isDeafened) return; // ممنوع تفتح المايك وانت عامل ميوت للسماعة زي ديسكورد
    if (!micStream) {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: noiseIsolation, autoGainControl: noiseIsolation }
            });
            isMicMuted = false;
            setupMicChain(micStream); // مايك > فلتر > ضاغط > (إرسال + VAD)
            const track = micOut.getAudioTracks()[0];
            if (peerConnection && peerConnection.connectionState === 'connected') {
                micSender = peerConnection.addTrack(track, micOut);
                await updateConnection();
            }
            updateMicUI();
            sfx('unmute');
        } catch {
            alert('تأكد من صلاحية المايكروفون!');
        }
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
        deafenBtn.textContent = 'السماعة: ميوت 🔕';
        deafenBtn.classList.add('danger');
        micStateBeforeDeafen = isMicMuted;
        if (!isMicMuted && micStream) {
            isMicMuted = true;
            micStream.getAudioTracks().forEach((t) => (t.enabled = false));
            updateMicUI();
        }
        sys('تم كتم السماعة والمايك (Deafen).');
    } else {
        deafenBtn.textContent = 'السماعة: شغالة 🎧';
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

volumeSlider.oninput = () => {
    applyRemoteAudio(); // نفس الشريط يتحكم بالمسار المُصفّى (أو العنصر العادي)
    remoteVideo.volume = volumeSlider.value;
};

// ===== 4. بث الشاشة + أزرار فوق الفيديو =====
async function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        if (peerConnection) [screenSender, screenAudioSender].forEach((s) => s && peerConnection.removeTrack(s));
        screenStream = null;
        screenSender = null;
        screenAudioSender = null;
        screenBtn.textContent = 'الشاشة: مطفي 🖥️';
        screenBtn.classList.remove('active');
        sendSignal({ stopVideo: true });
        await updateConnection();
    }
}

screenBtn.onclick = async () => {
    if (!screenStream) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const track = screenStream.getVideoTracks()[0];
            if (peerConnection && peerConnection.connectionState === 'connected') {
                addScreenTracks();
                await updateConnection();
            }
            track.onended = () => stopScreenShare();
            screenBtn.textContent = 'الشاشة: يبث 🔴';
            screenBtn.classList.add('active');
        } catch {}
    } else {
        await stopScreenShare();
    }
};

fullscreenBtn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (videoContainer.requestFullscreen) videoContainer.requestFullscreen(); // الحاوية كلها عشان تبقى الأزرار ظاهرة
};

streamAudioBtn.onclick = () => {
    streamMuted = !streamMuted;
    remoteVideo.muted = isDeafened || streamMuted;
    streamAudioBtn.textContent = streamMuted ? '🔇 صوت البث' : '🔊 صوت البث';
};

// ===== 5. الشات =====
function sendMessage() {
    const text = msgInput.value.trim();
    if (dataChannel && dataChannel.readyState === 'open' && text !== '') {
        const sender = getMyName();
        dataChannel.send(JSON.stringify({ sender, text }));
        addMsg(sender, text, true);
        msgInput.value = '';
    }
}

sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

renderMembers();
connectWebSocket();
// === نهاية الكود ===
