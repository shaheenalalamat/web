const SERVER_URL = 'wss://my-chat-server-cklh.onrender.com';
const TURN_API_URL = 'https://myapp222.metered.live/api/v1/turn/credentials?apiKey=xdOg3DmVOkph7BbC-8Gocxvv3ra70YJYCbhFA52FTAIB-cqA';

const fallbackIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

let ws = null;
let peerConnection = null;
let dataChannel = null;
let micStream = null;
let micSender = null;
let screenStream = null;
let screenSender = null;
let pendingCandidates = [];
let connectTimeout = null;

const chatBox = document.getElementById('chat-box');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const startBtn = document.getElementById('startBtn');
const micBtn = document.getElementById('micBtn');
const screenBtn = document.getElementById('screenBtn');
const remoteAudio = document.getElementById('remoteAudio');
const remoteVideo = document.getElementById('remoteVideo');

function logMessage(sender, message, color = 'white') {
    if (!chatBox) return;
    const p = document.createElement('p');
    p.style.color = color;
    const b = document.createElement('b');
    b.textContent = sender + ':';
    p.append(b, ' ', message);
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
}

window.addEventListener('error', (e) => {
    logMessage('خطأ برمجي', e.message, '#f44336');
});

// ===== جلب سيرفرات TURN من Metered مع مهلة 4 ثواني =====
async function loadIceConfiguration() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(TURN_API_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error('فشل جلب بيانات TURN');
        const meteredServers = await response.json();
        const combined = Array.isArray(meteredServers)
            ? [...fallbackIceServers, ...meteredServers]
            : fallbackIceServers;
        return { iceServers: combined };
    } catch {
        return { iceServers: fallbackIceServers };
    }
}

const iceConfigPromise = loadIceConfiguration();

// ===== 1. الاتصال بالسيرفر =====
function connectWebSocket() {
    logMessage('النظام', 'جاري الاتصال بالسيرفر...', '#8795a8');
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
        logMessage('النظام', 'متصل بالسيرفر ✅ جاهز للربط!', '#4caf50');
    };

    ws.onerror = () => {};

    ws.onclose = () => {
        logMessage('النظام', 'السيرفر لسا بيصحى، جاري إعادة المحاولة بعد 4 ثواني...', '#ff9800');
        setTimeout(connectWebSocket, 4000);
    };

    ws.onmessage = async (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        try {
            if (data.offer) {
                logMessage('النظام', 'استلمت طلب اتصال من صاحبك، جاري الرد...', '#03a9f4');
                if (!peerConnection || ['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState)) {
                    pendingCandidates = [];
                    await createPeerConnection();
                }
                startBtn.disabled = true;

                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                await flushPendingCandidates();

                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                sendSignal({ answer: answer });
            } else if (data.answer) {
                logMessage('النظام', 'صاحبك وافق على الاتصال، جاري فتح القناة...', '#03a9f4');
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
                remoteVideo.style.display = 'none';
            }
        } catch (err) {
            logMessage('خطأ إشارة', err.message, '#f44336');
        }
    };
}

async function flushPendingCandidates() {
    while (pendingCandidates.length > 0 && peerConnection) {
        const candidate = pendingCandidates.shift();
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

function sendSignal(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        return true;
    }
    logMessage('النظام', 'السيرفر مش متصل لسا، استنى ثواني.', '#f44336');
    return false;
}

// ===== 2. تجهيز اتصال P2P =====
async function createPeerConnection() {
    if (peerConnection) {
        peerConnection.onconnectionstatechange = null;
        peerConnection.onicecandidate = null;
        peerConnection.close();
    }

    const configuration = await iceConfigPromise;
    peerConnection = new RTCPeerConnection(configuration);

    if (micStream) {
        const track = micStream.getAudioTracks()[0];
        if (track) micSender = peerConnection.addTrack(track, micStream);
    }
    if (screenStream) {
        const track = screenStream.getVideoTracks()[0];
        if (track) screenSender = peerConnection.addTrack(track, screenStream);
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ iceCandidate: event.candidate });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        const linkText = document.getElementById('linkText');

        if (state === 'connected') {
            clearTimeout(connectTimeout);
            document.body.dataset.link = 'on';
            if (linkText) linkText.textContent = 'متصل';
            startBtn.innerText = 'متصل بنجاح';
            startBtn.disabled = true;
            logMessage('النظام', '✅ تم الاتصال المباشر (P2P) بنجاح!', '#4caf50');
        } else if (state === 'failed' || state === 'disconnected') {
            document.body.dataset.link = 'off';
            if (linkText) linkText.textContent = 'غير متصل';
            startBtn.innerText = 'بدء الاتصال (لأول شخص)';
            startBtn.disabled = false;
            logMessage('النظام', 'انقطع الاتصال المباشر. اكبس زر الاتصال مرة ثانية.', '#f44336');
        }
    };

    peerConnection.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            remoteAudio.srcObject = event.streams[0];
        } else if (event.track.kind === 'video') {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.style.display = 'block';
        }
    };

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
    };
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        clearTimeout(connectTimeout);
        logMessage('النظام', '💬 قناة الشات والصوت مفتوحة الآن!', '#4caf50');
    };
    dataChannel.onmessage = (e) => logMessage('صاحبك', e.data, '#ff9800');
}

async function updateConnection() {
    if (peerConnection && dataChannel && dataChannel.readyState === 'open') {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ offer: offer });
    }
}

// ===== 3. زر بدء الاتصال =====
startBtn.onclick = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        logMessage('النظام', 'استنى لحد ما يكتبلك (متصل بالسيرفر ✅) أولاً.', '#f44336');
        return;
    }

    startBtn.disabled = true;
    logMessage('النظام', 'جاري إرسال طلب الاتصال لصاحبك...', '#03a9f4');

    pendingCandidates = [];
    await createPeerConnection();
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal({ offer: offer });

    clearTimeout(connectTimeout);
    connectTimeout = setTimeout(() => {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            startBtn.disabled = false;
            logMessage('النظام', 'ما في رد من الطرف الثاني. تأكد إن صاحبك فاتح البرنامج ومتصل بالسيرفر، بعدين اكبس اتصال مرة ثانية.', '#ff9800');
        }
    }, 12000);
};

// ===== 4. المايك =====
micBtn.onclick = async () => {
    if (!micStream) {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioTrack = micStream.getAudioTracks()[0];
            if (peerConnection && peerConnection.connectionState === 'connected') {
                micSender = peerConnection.addTrack(audioTrack, micStream);
                await updateConnection();
            }
            micBtn.innerText = 'المايك: شغال 🎙️';
            logMessage('النظام', 'تم تشغيل المايك.', '#ffeb3b');
        } catch {
            alert('تأكد من صلاحية المايكروفون!');
        }
    } else {
        micStream.getTracks().forEach((track) => track.stop());
        if (peerConnection && micSender) peerConnection.removeTrack(micSender);
        micStream = null;
        micSender = null;
        micBtn.innerText = 'المايك: مطفي 🔇';
        logMessage('النظام', 'تم إطفاء المايك وتفريغ موارده.', '#aaa');
        await updateConnection();
    }
};

// ===== 5. بث الشاشة =====
async function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
        if (peerConnection && screenSender) peerConnection.removeTrack(screenSender);
        screenStream = null;
        screenSender = null;
        screenBtn.innerText = 'بث الشاشة: مطفي 🖥️';
        sendSignal({ stopVideo: true });
        logMessage('النظام', 'تم إطفاء البث وتفريغ الرام والمعالج.', '#aaa');
        await updateConnection();
    }
}

screenBtn.onclick = async () => {
    if (!screenStream) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const videoTrack = screenStream.getVideoTracks()[0];
            if (peerConnection && peerConnection.connectionState === 'connected') {
                screenSender = peerConnection.addTrack(videoTrack, screenStream);
                await updateConnection();
            }
            videoTrack.onended = () => stopScreenShare();
            screenBtn.innerText = 'بث الشاشة: شغال 🔴';
            logMessage('النظام', 'بدأ بث الشاشة المباشر!', '#ff4081');
        } catch {
            console.log('تم إلغاء بث الشاشة');
        }
    } else {
        await stopScreenShare();
    }
};

// ===== 6. إرسال الرسائل =====
function sendMessage() {
    const text = msgInput.value;
    if (dataChannel && dataChannel.readyState === 'open' && text.trim() !== '') {
        dataChannel.send(text);
        logMessage('أنت', text, '#03a9f4');
        msgInput.value = '';
    }
}

sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

connectWebSocket();
// === نهاية الكود ===