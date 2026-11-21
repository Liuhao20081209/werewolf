
    window.__APP_OK__ = true;
    (function () {
        const box = document.querySelector('.stars');
        if (!box || box.children.length) return;
        let seed = 20261121;
        const rnd = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        for (let i = 0; i < 72; i++) {
            const dot = document.createElement('span');
            const size = (1 + rnd() * 1.6).toFixed(2) + 'px';
            dot.style.left = (rnd() * 100).toFixed(2) + '%';
            dot.style.top = (rnd() * 62).toFixed(2) + '%';
            dot.style.width = size;
            dot.style.height = size;
            dot.style.opacity = (0.4 + rnd() * 0.55).toFixed(2);
            box.appendChild(dot);
        }
    })();
    (function () {
    })();
    (function () {
        const art = document.querySelector('.landscape');
        if (!art) return;
        function fitArt() {
            art.setAttribute('preserveAspectRatio',
                window.innerWidth <= 480 ? 'xMidYMax slice' : 'none');
        }
        fitArt();
        window.addEventListener('resize', fitArt);
    })();
    const VERSION = '202611211330';
    window.__VERSION__ = VERSION;

    function showNetBanner(text, isErr) {
        const el = document.getElementById('net-banner');
        if (!el) return;
        el.innerText = text;
        el.className = 'show' + (isErr ? '' : ' ok');
        if (!isErr) setTimeout(() => { el.className = ''; }, 2500);
    }
    (function healthCheck() {
        const url = '/api/version?t=' + Date.now();
        fetch(url, { cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => { window.__SERVER_VERSION__ = d.version || ''; })
            .catch(e => showNetBanner('服务器未连通[' + (e.message || '网络错误') + ']，登录一定失败，请先查隧道', true));
    })();

    let socket;
    try {
        socket = io({ transports: ['websocket', 'polling'], reconnection: true });
    } catch (e) {
        console.error('[socket.io 初始化失败]', e);
        showNetBanner('socket.io 客户端没加载成功，实时联机不可用[请检查 /socket.io/socket.io.js]', true);
        socket = { on: function () {}, emit: function () {}, connected: false, id: null };
    }
    let currentUser = sessionStorage.getItem('wolf_user') || '';
    let currentNickname = sessionStorage.getItem('wolf_nick') || '';
    let currentHostName = '';
    let currentRoomId = sessionStorage.getItem('wolf_room') || '';
    let selectedRoomId = '';

    function setRoomTab(tab) {
        const view = document.getElementById('room-view');
        if (!view) return;
        view.setAttribute('data-tab', tab === 'chat' ? 'chat' : 'main');
        document.querySelectorAll('.room-tab').forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-tab') === tab);
        });
    }
    let myRole = '';
    let currentPhase = 'waiting';
    let currentNightStep = '';
    let witchPendingKill = '';
    let hunterName = '';
    let lastGuardTarget = '';
    let isReady = false;
    let isAlive = true;
    let selectedTarget = '';
    let hasActed = false;
    let hostText = '';
    let lastListSig = '';
    let lastRoomData = null;

    const hostQueue = [];
    let hostShowing = false;
    let hostTimer = null;
    const HOST_DURATION_DEFAULT = 3600;
    const HOST_DURATION_FAST = 2400;

    function showNextHostMsg() {
        if (hostTimer) { clearTimeout(hostTimer); hostTimer = null; }
        if (!hostQueue.length) { hostShowing = false; return; }
        hostShowing = true;
        const text = hostQueue.shift();
        hostText = text;
        const el = document.getElementById('host-text');
        if (el) {
            el.innerHTML = hostHtml(text);
            el.classList.remove('host-in');
            void el.offsetWidth;
            el.classList.add('host-in');
        }
        const dur = hostQueue.length >= 3 ? HOST_DURATION_FAST : HOST_DURATION_DEFAULT;
        hostTimer = setTimeout(function () {
            hostTimer = null;
            if (hostQueue.length) showNextHostMsg();
            else hostShowing = false;
        }, dur);
    }

    function pushHostMsg(text, urgent) {
        if (!text) return;
        if (urgent) {
            hostQueue.length = 0;
            if (hostTimer) { clearTimeout(hostTimer); hostTimer = null; }
            hostShowing = false;
        }
        hostQueue.push(text);
        if (!hostShowing) showNextHostMsg();
    }

    function hostHtml(t) {
        return escHtml(String(t)).split('[[').join('<span class="dead-name">[').split(']]').join(']</span>');
    }

    function setHostText(text) { pushHostMsg(text, true); }

    function clearActionRows() {
        document.querySelectorAll('.action-row').forEach(function (r) { r.style.display = 'none'; });
        document.querySelectorAll('.action-btn').forEach(function (b) { b.classList.remove('active'); });
        if (currentPhase !== 'night' && currentPhase !== 'hunter_shoot') {
            selectedTarget = '';
            document.querySelectorAll('.player-item').forEach(function (p) { p.classList.remove('selected'); });
        }
    }

    function seatLetter(i) {
        let n = Math.max(0, parseInt(i, 10) || 0), s = '';
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
    }
    function seatOf(name) {
        if (!lastRoomData) return '';
        const i = lastRoomData.players.findIndex(function (p) { return p.name === name; });
        if (i < 0) return '';
        return lastRoomData.players[i].seat || seatLetter(i);
    }
    function nickOf(name) {
        if (!lastRoomData) return name;
        const p = lastRoomData.players.find(function (x) { return x.name === name; });
        const nick = (p && (p.nickname || p.name)) || name;
        const seat = seatOf(name);
        return seat ? seat + ' ' + nick : nick;
    }

    let skyTimer = null;
    let skyIsNight = document.body.classList.contains('night-mode');
    function applySky(wantNight) {
        if (wantNight === skyIsNight) { if (skyTimer) { clearTimeout(skyTimer); skyTimer = null; } return; }
        if (skyTimer) clearTimeout(skyTimer);
        const delay = wantNight ? 0 : 120;
        skyTimer = setTimeout(function () {
            skyTimer = null;
            skyIsNight = wantNight;
            document.body.classList.toggle('night-mode', wantNight);
        }, delay);
    }

    function hidePanelNow() {
        const panel = document.getElementById('action-panel');
        if (!panel) return;
        panel.classList.remove('on');
        panel.style.display = 'none';
        hideDock();
    }

    const DOCK_BTNS = {
        'guard-actions': [['守护', 'guard'], ['跳过', 'skip']],
        'wolf-actions': [['杀', 'kill'], ['不杀', 'skip']],
        'seer-actions': [['查验', 'check']],
        'witch-actions': [['用解药', 'save'], ['用毒药', 'poison'], ['跳过', 'skip']],
        'hunter-actions': [['开枪', 'shoot'], ['放弃', 'skip']],
        'day-actions': [['结束发言，准备投票', 'endDiscussion']]
    };

    function isWolfNightLike() {
        return currentPhase === 'night' && currentNightStep === 'wolf';
    }

    function hideDock() {
        const dock = document.getElementById('action-dock');
        if (!dock) return;
        dock.style.display = 'none';
        dock.dataset.row = '';
        dock.innerHTML = '';
    }

    function showRowNow(rowId) {
        const panel = document.getElementById('action-panel');
        if (panel) { panel.classList.remove('on'); panel.style.display = 'none'; }

        const dock = document.getElementById('action-dock');
        if (!dock) return;

        let btns = DOCK_BTNS[rowId] || [];
        let tip = '';
        if (hasActed && rowId !== 'day-actions') {
            btns = [];
            tip = isWolfNightLike() ? '' : '你这一阶段已经行动过了，等其他人';
        }
        let tipHtml = '';
        if (rowId === 'witch-actions') {
            const kill = witchPendingKill || '';
            const usedSave = !!(lastRoomData && lastRoomData.antidoteUsed);
            const usedPoison = !!(lastRoomData && lastRoomData.poisonUsed);
            if (kill && !usedSave) btns = [['用解药救 ' + kill, 'save']].concat(btns.slice(1));
            if (kill) {
                tip = '昨晚' + kill + '倒在了血泊中';
                tipHtml = '昨晚<span style="font-weight:700;color:#e0b64a;">' + escHtml(kill) + '</span>倒在了血泊中';
            } else {
                tip = '今晚没有人被袭击';
            }
            if (usedSave) tip += '（解药已用完）';
            if (usedPoison) tip += '（毒药已用完）';
        }
        const sig = rowId + '|' + btns.map(function (b) { return b[0]; }).join(',') + '|' + tip;
        if (dock.dataset.sig === sig && dock.style.display !== 'none' && dock.children.length) return;

        dock.dataset.sig = sig;
        dock.dataset.row = rowId;
        dock.innerHTML = '';
        dock.style.display = 'flex';
        dock.style.gap = '8px';
        dock.style.margin = '6px 0 8px';
        dock.style.position = 'sticky';
        dock.style.bottom = '6px';
        dock.style.zIndex = '30';

        const night = document.body.classList.contains('night-mode');
        if (tip) {
            const t = document.createElement('div');
            if (tipHtml) t.innerHTML = tipHtml + (tip.indexOf('（') >= 0 ? '<span style="opacity:.7;">' + tip.slice(tip.indexOf('（')) + '</span>' : '');
            else t.innerText = tip;
            t.style.flex = '0 0 100%';
            t.style.fontSize = '13px';
            t.style.lineHeight = '1.5';
            t.style.opacity = '.82';
            t.style.color = night ? '#d8c9a8' : '#5c4a33';
            t.style.margin = '0 0 6px';
            dock.appendChild(t);
            dock.style.flexWrap = 'wrap';
        }
        btns.forEach(function (pair) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerText = pair[0];
            btn.style.flex = '1';
            btn.style.minHeight = '46px';
            btn.style.padding = '10px 8px';
            btn.style.fontSize = '14px';
            btn.style.fontFamily = 'inherit';
            btn.style.borderRadius = '3px';
            btn.style.cursor = 'pointer';
            btn.style.pointerEvents = 'auto';
            btn.style.position = 'relative';
            btn.style.zIndex = '31';
            btn.style.border = night ? '1px solid rgba(190,166,124,.55)' : '1px solid rgba(120,96,62,.45)';
            btn.style.background = night ? 'rgba(70,57,38,.96)' : 'rgba(255,251,240,.96)';
            btn.style.color = night ? '#efe3c6' : '#3b2f1f';
            btn.style.boxShadow = '0 2px 0 rgba(0,0,0,.18)';
            btn.onclick = function () {
                if (pair[1] === 'endDiscussion') return endDiscussion();
                setAction(pair[1], btn);
            };
            dock.appendChild(btn);
        });
        if (!tip) dock.style.flexWrap = 'nowrap';
        if (!btns.length && !tip) hideDock();
    }

    function paintActionPanel(room) {
        if (!room || !room.state) return;
        const me = (room.players || []).filter(function (p) { return p.name === currentUser; })[0];
        if (!me) return;
        if (room.state === 'night') {
            if (!me.alive) return hidePanelNow();
            if (me.hasActed && me.role !== '狼人') return hidePanelNow();
            if (room.nightStep === 'guard' && me.role === '守卫') return showRowNow('guard-actions');
            if (room.nightStep === 'wolf' && me.role === '狼人') return showRowNow('wolf-actions');
            if (room.nightStep === 'witch' && me.role === '女巫') return showRowNow('witch-actions');
            if (room.nightStep === 'seer' && me.role === '预言家') return showRowNow('seer-actions');
            return hidePanelNow();
        }
        if (room.state === 'hunter_shoot') {
            if (room.hunterName === me.name && !me.hasActed) return showRowNow('hunter-actions');
            return hidePanelNow();
        }
        if (room.state === 'day_discuss') {
            if (!me.alive || me.hasActed) return hidePanelNow();
            return showRowNow('day-actions');
        }
        hidePanelNow();
    }

    function desiredRow(room) {
        if (!room || !room.state) return '';
        const me = (room.players || []).filter(function (p) { return p.name === currentUser; })[0];
        if (!me) return '';
        if (room.state === 'night') {
            if (!me.alive) return '';
            if (me.hasActed && me.role !== '狼人') return '';
            if (room.nightStep === 'guard' && me.role === '守卫') return 'guard-actions';
            if (room.nightStep === 'wolf' && me.role === '狼人') return 'wolf-actions';
            if (room.nightStep === 'witch' && me.role === '女巫') return 'witch-actions';
            if (room.nightStep === 'seer' && me.role === '预言家') return 'seer-actions';
            return '';
        }
        if (room.state === 'hunter_shoot') return (room.hunterName === me.name && !me.hasActed) ? 'hunter-actions' : '';
        if (room.state === 'day_discuss') return (!me.alive || me.hasActed) ? '' : 'day-actions';
        return '';
    }

    function repaintTick() {
        if (!currentRoomId || !lastRoomData) return;
        if (lastRoomData.state === 'waiting' || lastRoomData.state === 'gameover') return;
        const want = desiredRow(lastRoomData);
        const panel = document.getElementById('action-panel');
        if (!panel) return;
        let nowRow = '';
        panel.querySelectorAll('.action-row').forEach(function (r) {
            if (r.style.display !== 'none' && r.children.length) nowRow = r.id;
        });
        if (want === nowRow) {
            if (want && panel.style.display !== 'flex') {
                panel.style.display = 'flex';
                panel.classList.add('on');
            }
            if (!want) syncPanelEmpty();
            return;
        }
        if (want) showRowNow(want);
        else hidePanelNow();
    }

    if (!window.__panelTick) window.__panelTick = setInterval(repaintTick, 700);

    function refreshPanel() {
        refreshPanelCore();
        syncPanelEmpty();
        paintActionPanel(lastRoomData);
    }

    function syncPanelEmpty() {
        const panel = document.getElementById('action-panel');
        if (!panel) return;
        if (panel.style.display === 'none') return;
        const rows = panel.querySelectorAll('.action-row');
        let any = false;
        rows.forEach(function (r) {
            if (r.style.display !== 'none' && r.children.length) any = true;
        });
        if (!any) panel.style.display = 'none';
    }

    function refreshPanelCore() {
        const panel = document.getElementById('action-panel');
        const input = document.getElementById('chat-input');
        if (!panel || !input) return;

        clearActionRows();

        applySky(currentPhase === 'night');

        if (currentPhase === 'hunter_shoot') {
            if (currentUser === hunterName && !hasActed) {
                showRowNow('hunter-actions');
                input.disabled = true;
                input.placeholder = '请选择开枪目标';
            } else {
                hidePanelNow();
                input.disabled = true;
                input.placeholder = '等待猎人开枪';
            }
            return;
        }

        if (!isAlive) {
            hidePanelNow();
            input.disabled = true;
            input.placeholder = '你已出局，仍然不能看见身份，静看局势';
            return;
        }

        if (currentPhase === 'night') {
            if (hasActed && !(currentNightStep === 'wolf' && myRole === '狼人')) {
                hidePanelNow();
                input.disabled = true;
                input.placeholder = '天黑请闭眼，禁止发言';
                return;
            }

            if (currentNightStep === 'guard' && myRole === '守卫') {
                showRowNow('guard-actions');
                input.disabled = true;
                input.placeholder = '天黑请闭眼，禁止发言';
            } else if (currentNightStep === 'wolf' && myRole === '狼人') {
                showRowNow('wolf-actions');
                input.disabled = false;
                input.placeholder = hasActed ? '已提交,可重新选一次' : '可以和队友交流，不会被别人看见';
            } else if (currentNightStep === 'witch' && myRole === '女巫') {
                showRowNow('witch-actions');
                input.disabled = true;
                input.placeholder = '天黑请闭眼，禁止发言';
                const saveBtn = document.getElementById('witch-save-btn');
                const usedSave = !!(lastRoomData && lastRoomData.antidoteUsed);
                const usedPoison = !!(lastRoomData && lastRoomData.poisonUsed);
                const poisonBtn = document.getElementById('witch-poison-btn');
                if (usedSave) {
                    saveBtn.innerText = '解药已用完';
                    saveBtn.disabled = true;
                } else if (witchPendingKill) {
                    const meObj = ((lastRoomData && lastRoomData.players) || []).filter(function (x) { return x.name === currentUser; })[0];
                    const myNick = meObj ? (meObj.nickname || meObj.name) : '';
                    if (witchPendingKill === myNick) {
                        saveBtn.innerText = '狼人目标是你，不能自救';
                        saveBtn.disabled = true;
                    } else {
                        saveBtn.innerText = '用解药救 ' + witchPendingKill;
                        saveBtn.disabled = false;
                    }
                } else {
                    saveBtn.innerText = '用解药[平安夜]';
                    saveBtn.disabled = true;
                }
                if (poisonBtn) {
                    if (usedPoison) { poisonBtn.innerText = '毒药已用完'; poisonBtn.disabled = true; }
                    else { poisonBtn.innerText = '用毒药'; poisonBtn.disabled = false; }
                }
            } else if (currentNightStep === 'seer' && myRole === '预言家') {
                showRowNow('seer-actions');
                input.disabled = true;
                input.placeholder = '天黑请闭眼，禁止发言';
            } else {
                hidePanelNow();
                input.disabled = true;
                input.placeholder = '天黑请闭眼，禁止发言';
            }
        } else if (currentPhase === 'day_discuss') {
            input.disabled = false;
            input.placeholder = '天亮了，请讨论';
            if (hasActed) {
                hidePanelNow();
            } else {
                showRowNow('day-actions');
            }
        } else if (currentPhase === 'day_vote') {
            hidePanelNow();
            input.disabled = false;
            const total = lastRoomData ? lastRoomData.players.filter(function (p) { return p.alive; }).length : 0;
            const done = lastRoomData ? Object.keys(lastRoomData.votes || {}).length : 0;
            input.placeholder = '投票中[' + done + '/' + total + ']，可继续讨论';
        } else {
            hidePanelNow();
            input.disabled = false;
            input.placeholder = currentPhase === 'waiting'
                ? '等待玩家准备，可先聊两句'
                : '输入讨论内容';
        }
    }

    async function autoLoginFromUrl() {
        const params = new URLSearchParams(location.search);
        const as = params.get('as');
        if (!as) return;
        if (sessionStorage.getItem('wolf_user') === as) return;

        sessionStorage.removeItem('wolf_room');
        sessionStorage.removeItem('wolf_user');
        currentRoomId = '';

        const pwd = params.get('pwd') || '123456';
        const headers = { 'Content-Type': 'application/json' };
        const body = JSON.stringify({ user: as, pwd, nickname: as });

        try {
            let res = await fetch('/api/login', { method: 'POST', headers, body });
            let data = await res.json();
            if (!data.ok) {
                await fetch('/api/register', { method: 'POST', headers, body });
                res = await fetch('/api/login', { method: 'POST', headers, body });
                data = await res.json();
            }
            if (data.ok) {
                currentUser = as;
                currentNickname = data.nickname || as;
                sessionStorage.setItem('wolf_user', as);
                sessionStorage.setItem('wolf_nick', currentNickname);
                sessionStorage.setItem('wolf_admin', data.isAdmin ? '1' : '0');
                if (data.token) {
                    userToken = data.token;
                    localStorage.setItem('wolf_token', userToken);
                }
                showAdminEntry(!!data.isAdmin);
                showUpdateNotice();
            }
        } catch (e) {
            console.error('自动登录失败', e);
        }
    }

    socket.on('connect', function () {
        if (currentUser) socket.emit('identify', { token: userToken, nickname: currentNickname || currentUser });
        if (currentUser && currentRoomId) {
            socket.emit('joinRoom', { roomId: currentRoomId, user: currentUser, nickname: currentNickname || currentUser });
        }
    });

    const ROLE_UI_COLOR = { '狼人': '#b4453b', '平民': '#4b7a46', '预言家': '#7a5aa8', '猎人': '#5f7350', '守卫': '#3f6f9e', '女巫': '#5b7a8c' };
    socket.on('assignRole', function (role) {
        myRole = role;
        const rt = document.getElementById('role-text');
        rt.innerText = role;
        rt.style.color = ROLE_UI_COLOR[role] || '';
        document.getElementById('my-role-badge').style.display = 'flex';
        const box = document.getElementById('chat-box');
        if (box) box.innerHTML = '';
    });

    socket.on('hostMsg', function (msg) {
        const text = (msg && typeof msg === 'object') ? String(msg.text || '') : String(msg || '');
        pushHostMsg(text, false);
    });

    /* ================= 语音聊天（WebRTC，一个人开麦，全房间都能听） ================= */
    let voiceOn = false;
    let voiceStream = null;
    let voiceCtx = null;
    let voiceLevelTimer = 0;
    let voiceCount = 0;
    let voiceBusy = false;
    const voicePeers = new Map();

    const MIC_ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="9" y="2.6" width="6" height="10.4" rx="3"/>'
        + '<path d="M5.2 11a6.8 6.8 0 0 0 13.6 0"/>'
        + '<path d="M12 17.8V21"/><path d="M8.6 21h6.8"/>'
        + '</svg>';
    const MIC_ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="9" y="2.6" width="6" height="10.4" rx="3"/>'
        + '<path d="M5.2 11a6.8 6.8 0 0 0 10.8 5.4"/>'
        + '<path d="M12 17.8V21"/><path d="M8.6 21h6.8"/>'
        + '<path d="M3.4 3.4l17.2 17.2"/>'
        + '</svg>';

    function setSpeakDot(name, on) {
        document.querySelectorAll('.p-speak').forEach(function (el) {
            if (el.getAttribute('data-name') === name) el.classList.toggle('on', !!on);
        });
    }
    function clearSpeakDots() {
        document.querySelectorAll('.p-speak').forEach(function (el) { el.classList.remove('on'); });
    }
    function voiceTip(msg, isErr) {
        const el = document.getElementById('voice-tip');
        if (!el) return;
        if (!msg) { el.style.display = 'none'; el.innerText = ''; return; }
        el.style.display = 'block';
        el.className = 'voice-tip' + (isErr ? '' : ' ok');
        el.innerText = msg;
        clearTimeout(el._timer);
        if (!isErr) el._timer = setTimeout(function () { el.style.display = 'none'; }, 5000);
    }
    function voiceStatusUI() {
        const mic = document.getElementById('mic-btn');
        if (mic) {
            mic.innerHTML = voiceOn ? MIC_ICON_ON : MIC_ICON_OFF;
            mic.classList.toggle('on', voiceOn);
            mic.title = voiceOn ? '闭麦' : '开麦';
            mic.setAttribute('aria-label', voiceOn ? '闭麦' : '开麦');
        }
    }
    function voiceKickAudio() {
        document.querySelectorAll('#voice-audios audio').forEach(function (a) {
            const pr = a.play();
            if (pr && pr.catch) pr.catch(function () { });
        });
    }
    document.addEventListener('click', voiceKickAudio, true);

    function voiceAttachMic(pc) {
        if (!voiceStream) return false;
        let ok = false;
        voiceStream.getTracks().forEach(function (t) {
            try { pc.addTrack(t, voiceStream); ok = true; } catch (e) { }
        });
        return ok;
    }
    function voiceCreatePeer(id, name, initiator, withMic) {
        if (!id) return null;
        let entry = voicePeers.get(id);
        if (entry) return entry;
        let pc;
        try {
            pc = new RTCPeerConnection({
                iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
            });
        } catch (e) { return null; }
        entry = { pc: pc, name: name || '玩家', pending: [], remoteSet: false, hasMic: false };
        voicePeers.set(id, entry);

        pc.onicecandidate = function (ev) {
            if (ev.candidate) socket.emit('voiceSignal', { to: id, signal: { candidate: ev.candidate } });
        };
        pc.ontrack = function (ev) {
            const stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
            let a = document.getElementById('va-' + id);
            if (!a) {
                a = document.createElement('audio');
                a.id = 'va-' + id;
                a.autoplay = true;
                a.playsInline = true;
                a.style.display = 'none';
                document.getElementById('voice-audios').appendChild(a);
            }
            a.srcObject = stream;
            const pr = a.play();
            if (pr && pr.catch) pr.catch(function () {
                voiceTip('点一下页面任意位置，恢复语音声音', true);
            });
        };
        pc.onconnectionstatechange = function () {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') voiceDropPeer(id);
        };
        if (withMic && voiceStream) entry.hasMic = voiceAttachMic(pc);
        if (initiator) voiceOfferTo(id, entry);
        return entry;
    }
    function voiceOfferTo(id, entry) {
        try {
            entry.pc.createOffer()
                .then(function (offer) { return entry.pc.setLocalDescription(offer); })
                .then(function () { socket.emit('voiceSignal', { to: id, signal: { sdp: entry.pc.localDescription } }); })
                .catch(function () { voiceDropPeer(id); });
        } catch (e) { }
    }
    function voiceDropPeer(id) {
        const entry = voicePeers.get(id);
        if (entry) {
            try { entry.pc.close(); } catch (e) { }
            voicePeers.delete(id);
            setSpeakDot(entry.name, false);
        }
        const a = document.getElementById('va-' + id);
        if (a) { try { a.srcObject = null; } catch (e) { } a.remove(); }
    }
    function voiceListenSpeakers(peers) {
        (peers || []).forEach(function (p) {
            if (!p || !p.id) return;
            if (voicePeers.has(p.id)) return;
            voiceCreatePeer(p.id, p.nickname || p.name, true, voiceOn);
        });
        voiceStatusUI();
    }
    function voiceConnectAudience(peers) {
        (peers || []).forEach(function (p) {
            if (!p || !p.id) return;
            let entry = voicePeers.get(p.id);
            if (!entry) {
                voiceCreatePeer(p.id, p.nickname || p.name, true, true);
                return;
            }
            if (voiceStream && !entry.hasMic) {
                entry.hasMic = voiceAttachMic(entry.pc);
                voiceOfferTo(p.id, entry);
            }
        });
        voiceStatusUI();
    }

    function startLocalVoiceLevel() {
        stopLocalVoiceLevel();
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx || !voiceStream) return;
            const ctx = new Ctx();
            voiceCtx = ctx;
            const src = ctx.createMediaStreamSource(voiceStream);
            const ana = ctx.createAnalyser();
            ana.fftSize = 512;
            ana.smoothingTimeConstant = 0.65;
            src.connect(ana);
            const buf = new Uint8Array(ana.frequencyBinCount);
            let last = false;
            voiceLevelTimer = setInterval(function () {
                if (!voiceOn) return;
                ana.getByteFrequencyData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) sum += buf[i];
                const level = sum / buf.length;
                const now = level > 38;
                if (now !== last) {
                    last = now;
                    setSpeakDot(currentUser, now);
                    socket.emit('voiceSpeaking', { on: now });
                }
            }, 150);
        } catch (e) { }
    }
    function stopLocalVoiceLevel() {
        if (voiceLevelTimer) { clearInterval(voiceLevelTimer); voiceLevelTimer = 0; }
        if (voiceCtx) { try { voiceCtx.close(); } catch (e) { } voiceCtx = null; }
    }

    async function toggleMic() {
        if (voiceBusy) return;
        if (voiceOn) { micMute(); return; }
        if (!window.isSecureContext) {
            voiceTip('语音聊天需要 HTTPS 访问（localhost 除外）当前是 HTTP，浏览器会直接拒绝麦克风', true);
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
            voiceTip('当前浏览器不支持语音聊天', true);
            return;
        }
        const reuse = voiceStream && voiceStream.getAudioTracks().some(function (t) { return t.readyState === 'live'; });
        voiceBusy = true;
        try {
            if (!reuse) {
                voiceTip('正在申请麦克风权限…', false);
                voiceStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
                    video: false
                });
            }
        } catch (e) {
            voiceStream = null;
            voiceBusy = false;
            const msg = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
                ? '麦克风权限被拒绝请在浏览器地址栏左侧允许麦克风后重试'
                : e && e.name === 'NotFoundError'
                    ? '没有检测到麦克风设备'
                    : '打不开麦克风：' + ((e && e.name) || '未知错误');
            voiceTip(msg, true);
            return;
        }
        voiceBusy = false;
        voiceStream.getTracks().forEach(function (t) { t.enabled = true; });
        voiceOn = true;
        voiceStatusUI();
        socket.emit('voiceOn');
        startLocalVoiceLevel();
        voiceTip('麦克风已打开，房间里所有人都能听见你', false);
        Array.from(voicePeers.entries()).forEach(function (pair) {
            const entry = pair[1];
            if (voiceStream && !entry.hasMic) {
                entry.hasMic = voiceAttachMic(entry.pc);
                voiceOfferTo(pair[0], entry);
            }
        });
    }

    function micMute() {
        voiceOn = false;
        stopLocalVoiceLevel();
        if (voiceStream) {
            voiceStream.getTracks().forEach(function (t) { t.enabled = false; });
        }
        setSpeakDot(currentUser, false);
        socket.emit('voiceOff');
        voiceStatusUI();
        voiceTip('已闭麦，仍然可以收听其他人', false);
    }

    function stopVoice(hard) {
        const wasOn = voiceOn || !!voiceStream;
        voiceOn = false;
        stopLocalVoiceLevel();
        if (voiceStream) {
            try { voiceStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
            voiceStream = null;
        }
        Array.from(voicePeers.keys()).forEach(voiceDropPeer);
        voicePeers.clear();
        clearSpeakDots();
        if (wasOn) socket.emit('voiceOff');
        if (hard) voiceCount = 0;
        voiceStatusUI();
        if (hard) voiceTip('语音已关闭', false);
    }

    socket.on('voiceAudience', function (d) {
        voiceConnectAudience(d && d.peers);
    });
    socket.on('voiceSpeakers', function (d) {
        voiceListenSpeakers(d && d.peers);
    });
    socket.on('voiceNewcomer', function (p) {
        if (!voiceOn || !p || !p.id) return;
        voiceCreatePeer(p.id, p.nickname || p.name, true, true);
    });
    socket.on('voicePeerOn', function (p) {
        if (p) voiceTip((p.nickname || p.name) + ' 开麦了', false);
    });
    socket.on('voicePeerMute', function (p) {
        if (!p) return;
        const entry = voicePeers.get(p.id);
        if (entry) setSpeakDot(entry.name, false);
        voiceTip((p.nickname || p.name || '对方') + ' 闭麦了', false);
    });
    socket.on('voicePeerOff', function (p) {
        voiceDropPeer(p && p.id);
        if (p) voiceTip((p.nickname || p.name || '对方') + ' 离开了语音', false);
    });
    socket.on('voiceState', function (d) {
        voiceCount = (d && typeof d.on === 'number') ? d.on : 0;
        voiceStatusUI();
    });
    socket.on('voiceSpeaking', function (d) { if (d && typeof d.name === 'string' && d.name) setSpeakDot(d.name, !!d.on); });
    socket.on('voiceSignal', async function (msg) {
        if (!msg || !msg.from) return;
        let entry = voicePeers.get(msg.from);
        if (!entry) {
            voiceCreatePeer(msg.from, msg.name || '玩家', false, voiceOn);
            entry = voicePeers.get(msg.from);
            if (!entry) return;
        }
        const pc = entry.pc;
        const signal = msg.signal || {};
        try {
            if (signal.sdp) {
                if (signal.sdp.type === 'offer') {
                    await pc.setRemoteDescription(signal.sdp);
                    entry.remoteSet = true;
                    for (const c of entry.pending) { try { await pc.addIceCandidate(c); } catch (e) { } }
                    entry.pending = [];
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    socket.emit('voiceSignal', { to: msg.from, signal: { sdp: pc.localDescription } });
                } else if (signal.sdp.type === 'answer') {
                    await pc.setRemoteDescription(signal.sdp);
                    entry.remoteSet = true;
                    for (const c of entry.pending) { try { await pc.addIceCandidate(c); } catch (e) { } }
                    entry.pending = [];
                }
            } else if (signal.candidate) {
                if (entry.remoteSet) await pc.addIceCandidate(signal.candidate).catch(function () { });
                else entry.pending.push(signal.candidate);
            }
        } catch (e) { }
    });
    socket.on('disconnect', function () {
        if (voiceOn || voiceStream || voicePeers.size) {
            stopVoice(true);
            voiceTip('连接已断开，语音已停止，重连后可重新开麦', true);
        }
    });
    window.addEventListener('beforeunload', function () { if (voiceOn) stopVoice(true); });

    voiceStatusUI();

    socket.on('phaseDeadline', function (data) {
        phaseDeadline = data && data.at ? data : null;
        if (lastRoomData) applyRoomUpdate(lastRoomData);
    });

    socket.on('nudge', function (data) {
        const from = (data && data.from) || '房主';
        uiConfirm(from + ' 在催你准备，现在就去点「准备就绪」吗？', function () { toggleReady(); });
    });

    socket.on('witchInfo', function (data) {
        witchPendingKill = data.pendingKill || '';
        if (myRole === '女巫' && currentPhase === 'night' && currentNightStep === 'witch') {
            refreshPanel();
        }
    });

    socket.on('guardInfo', function (data) {
        lastGuardTarget = data.lastTarget || '';
    });

    function resetAuthBtn() {
        const btn = document.getElementById('login-submit');
        if (btn) { btn.disabled = false; btn.innerText = '登录'; }
        const box = document.getElementById('msg-box');
        if (box) { box.style.display = 'none'; box.innerText = ''; }
    }
    function keepSubmitVisible() {
        const btn = document.getElementById('login-submit');
        if (!btn) return;
        const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        const r = btn.getBoundingClientRect();
        if (r.bottom > vh - 12 || r.top < 8) {
            btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }
    function openAuth() {
        resetAuthBtn();
        toggleAuth('login');
        document.getElementById('auth-modal').style.display = 'flex';
        const ae = document.activeElement;
        if (ae && ae.blur) ae.blur();
    }
    let uiDialogCb = null;
    function uiDialogClose(ok) {
        const d = document.getElementById('ui-dialog');
        if (d) d.style.display = 'none';
        const cb = uiDialogCb;
        uiDialogCb = null;
        if (cb) cb(!!ok);
    }
    function openUiDialog(text, showCancel, onOk, onCancel) {
        const box = document.getElementById('ui-dialog');
        if (!box) return;
        document.getElementById('ui-dialog-text').innerText = String(text || '');
        document.getElementById('ui-dialog-cancel').style.display = showCancel ? '' : 'none';
        document.getElementById('ui-dialog-ok').innerText = showCancel ? '确定' : '知道了';
        uiDialogCb = function (ok) {
            if (ok) { if (onOk) onOk(); return; }
            if (onCancel) onCancel();
        };
        box.style.display = 'flex';
    }
    function uiConfirm(text, onOk, onCancel) { openUiDialog(text, true, onOk, onCancel); }
    function uiAlert(text, onOk) { openUiDialog(text, false, onOk, null); }

    function noticeToHtml(text) {
        const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
        const sections = [];
        let title = '更新公告';
        let cur = null;
        function addSection(red, name) {
            cur = { red: !!red, title: String(name || ''), items: [] };
            sections.push(cur);
            return cur;
        }
        function addItem(item) {
            if (!cur) addSection(false, '');
            cur.items.push(String(item || ''));
        }
        lines.forEach(function (raw) {
            const line = String(raw || '').trim();
            if (!line || line.charAt(0) === ';' || line.indexOf('//') === 0) return;
            if (/^#\s+/.test(line)) {
                title = line.replace(/^#\s+/, '');
                return;
            }
            if (/^##\s+/.test(line)) {
                let name = line.replace(/^##\s+/, '');
                let red = false;
                if (/^!red\s+/i.test(name)) { red = true; name = name.replace(/^!red\s+/i, ''); }
                if (/^\[red\]\s*/i.test(name)) { red = true; name = name.replace(/^\[red\]\s*/i, ''); }
                addSection(red, name);
                return;
            }
            if (/^(?:-|\*|·)\s+/.test(line)) {
                addItem(line.replace(/^(?:-|\*|·)\s+/, ''));
                return;
            }
            if (/^(?:[ivxlcdm]+|\d+)[.、)]\s+/i.test(line)) {
                addItem(line);
                return;
            }
            addItem(line);
        });
        let html = '';
        sections.forEach(function (sec) {
            if (sec.title) html += '<div class="notice-sec' + (sec.red ? ' red' : '') + '">' + escHtml(sec.title) + '</div>';
            sec.items.forEach(function (item) {
                if (item.trim()) html += '<div class="notice-item">' + escHtml(item) + '</div>';
            });
        });
        if (!sections.length) html = '<div class="notice-item">' + escHtml(text || '暂无公告') + '</div>';
        return { title: title, html: html };
    }

    function loadUpdateNotice() {
        const body = document.getElementById('notice-body');
        const heading = document.getElementById('notice-title');
        if (!body) return Promise.resolve();
        body.innerHTML = '<div class="notice-item">正在读取公告…</div>';
        return fetch('/api/notice', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (!data || data.ok === false) {
                    if (heading) heading.textContent = '更新公告';
                    body.innerHTML = '<div class="notice-item">没有找到公告文件 notice.txt，请把公告文本放到服务端根目录</div>';
                    return;
                }
                const parsed = noticeToHtml(data.text || '');
                if (heading) heading.textContent = parsed.title;
                body.innerHTML = parsed.html;
            })
            .catch(function () {
                if (heading) heading.textContent = '更新公告';
                body.innerHTML = '<div class="notice-item">公告读取失败，请检查根目录的 notice.txt</div>';
            });
    }

    function showUpdateNotice() {
        const box = document.getElementById('notice-dialog');
        if (!box) return;
        loadUpdateNotice().then(function () { box.style.display = 'flex'; });
    }
    function closeUpdateNotice() {
        const box = document.getElementById('notice-dialog');
        if (box) box.style.display = 'none';
    }

    function closeAuth() {
        document.getElementById('auth-modal').style.display = 'none';
        const ae = document.activeElement;
        if (ae && ae.blur) ae.blur();
    }

    function openProfile() {
        const av = document.getElementById('pf-avatar');
        av.src = avatarPlaceholder(currentNickname || currentUser);
        if (currentUser) {
            getJson('/api/card?user=' + encodeURIComponent(currentUser) + '&me=' + encodeURIComponent(currentUser))
                .then(function (d) {
                    if (d && d.ok && d.card.avatar) av.src = d.card.avatar;
                    if (d && d.ok) document.getElementById('pf-sign').value = d.card.signature || '';
                }).catch(function () {});
        }
        document.getElementById('pf-nick').value = currentNickname || currentUser;
        document.getElementById('pf-sign').value = '';
        document.getElementById('pf-old').value = '';
        document.getElementById('pf-new').value = '';
        document.getElementById('pf-msg').style.display = 'none';
        document.getElementById('profile-modal').style.display = 'flex';
    }
    function closeProfile() {
        document.getElementById('profile-modal').style.display = 'none';
    }
    function pfMsg(text, isErr) {
        const box = document.getElementById('pf-msg');
        box.innerText = text;
        box.className = 'msg ' + (isErr ? 'err' : 'ok');
        box.style.display = 'block';
    }
    async function saveProfile() {
        const nick = document.getElementById('pf-nick').value.trim();
        const sign = document.getElementById('pf-sign').value.trim();
        const oldPwd = document.getElementById('pf-old').value;
        const newPwd = document.getElementById('pf-new').value;
        if (!nick) return pfMsg('昵称不能为空', true);
        if (!oldPwd) return pfMsg('请输入当前密码', true);
        let data;
        try {
            data = await postJson('/api/profile',
                { user: currentUser, oldPwd: oldPwd, nickname: nick, newPwd: newPwd, signature: sign });
        } catch (e) {
            console.error('保存失败', e);
            return pfMsg('连不上服务器[网络或隧道异常]，请刷新后重试', true);
        }
        if (!data.ok) return pfMsg(data.msg, true);

        currentNickname = data.nickname;
        sessionStorage.setItem('wolf_nick', currentNickname);
        document.getElementById('cur-user').innerText = currentNickname;
        socket.emit('identify', { token: userToken, nickname: currentNickname });
        if (currentRoomId) {
            socket.emit('setNickname', { roomId: currentRoomId, user: currentUser, nickname: currentNickname });
        }
        pfMsg(newPwd ? '已保存，密码已更新' : '已保存', false);
        setTimeout(closeProfile, 1200);
    }

    let __lastAuthTap = 0;
    function authTapOnce() {
        const now = Date.now();
        if (now - __lastAuthTap < 500) return false;
        __lastAuthTap = now;
        return true;
    }
    function pointInEl(x, y, el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    document.addEventListener('pointerdown', function (e) {
        const m = document.getElementById('auth-modal');
        if (!m || !m.style.display || m.style.display === 'none') return;
        if (!pointInEl(e.clientX, e.clientY, document.getElementById('login-submit'))) return;
        login();
    }, { capture: true, passive: true });


    document.addEventListener('contextmenu', function (e) {
        const t = e.target && e.target.closest ? e.target.closest('button, .mp-btn, .btn, .action-btn') : null;
        if (t) e.preventDefault();
    }, true);

    window.addEventListener('error', function (e) {
        try {
            const where = e && e.lineno ? '[' + (e.lineno) + '行]' : '';
            showMsg('页面脚本异常' + where + '：' + ((e && e.message) || '未知错误'), true);
            console.error('页面脚本异常', e && e.message, e && e.filename, e && e.lineno);
        } catch (x) { }
    });
    window.addEventListener('unhandledrejection', function (e) {
        try { showMsg('请求异常：' + ((e && e.reason && e.reason.message) || '未知错误'), true); } catch (x) {}
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function () {
            const m = document.getElementById('auth-modal');
            if (m && getComputedStyle(m).display !== 'none') keepSubmitVisible();
        });
    }
    ['l-user', 'l-pwd'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('focus', function () { setTimeout(keepSubmitVisible, 350); });
    });
    (function () {
        const m = document.getElementById('auth-modal');
        if (!m) return;
        m.addEventListener('touchstart', function (e) {
            if (e.target === m) {
                const ae = document.activeElement;
                if (ae && ae.blur) ae.blur();
            }
        }, { passive: true });
    })();

    function toggleAuth(type) {
        document.getElementById('login-form').style.display = type === 'login' ? 'block' : 'none';
        document.getElementById('reg-form').style.display = type === 'reg' ? 'block' : 'none';
    }
    async function postJson(url, body) {
        if (userToken && body && typeof body === 'object' && !body.token) body.token = userToken;
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 10000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { throw new Error('返回内容不是 JSON[可能是网关错误页]'); }
        } finally { clearTimeout(timer); }
    }
    async function getJson(url) {
        if (userToken) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(userToken);
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 10000);
        try {
            const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { throw new Error('返回内容不是 JSON'); }
        } finally { clearTimeout(timer); }
    }
    async function authRequest(path, params) {
        let firstErr = null;
        try { return await postJson(path, params); } catch (e) { firstErr = e; }
        try { return await getJson(path + '?' + new URLSearchParams(params).toString()); }
        catch (e) { throw firstErr; }
    }
    function showMsg(text, isErr) {
        const box = document.getElementById('msg-box');
        box.innerText = text;
        box.className = 'msg ' + (isErr ? 'err' : 'ok');
        box.style.display = 'block';
        setTimeout(function () { box.style.display = 'none'; }, 3000);
    }
    async function register() {
        if (!authTapOnce()) return;
        const u = document.getElementById('r-user').value.trim();
        const n = document.getElementById('r-nick').value.trim();
        const p = document.getElementById('r-pwd').value;
        if (!u || !p) return showMsg('请填写完整', true);
        if (!n) return showMsg('请设置昵称', true);
        let data;
        try {
            data = await authRequest('/api/register', { user: u, pwd: p, nickname: n });
        } catch (e) {
            console.error('注册失败', e);
            return showMsg('连不上服务器[网络或隧道异常]，请刷新后重试', true);
        }
        showMsg(data.msg, !data.ok);
        if (data.ok) toggleAuth('login');
    }
    async function login() {
        if (!authTapOnce()) return;
        const u = document.getElementById('l-user').value.trim();
        const p = document.getElementById('l-pwd').value;
        if (!u || !p) return showMsg('请填写完整', true);
        const btn = document.getElementById('login-submit');
        if (btn) { btn.disabled = true; btn.innerText = '登录中…'; }
        showMsg('登录中…', false);
        keepSubmitVisible();
        let data = null;
        try {
            data = await authRequest('/api/login', { user: u, pwd: p });
        } catch (e) {
            console.error('登录失败', e);
            const raw = (e && e.message) || '';
            const friendly = /Failed to fetch|NetworkError|abort|timed?out/i.test(raw)
                ? '连不上服务器[网络或隧道异常]，请刷新后重试'
                : ('登录异常：' + (raw || '未知错误'));
            return showMsg(friendly, true);
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '登录'; }
        }
        if (!data) return showMsg('服务器无响应，请刷新后重试', true);
        if (data.ok) {
            currentUser = data.username || u;
            currentNickname = data.nickname || currentUser;
            sessionStorage.setItem('wolf_user', currentUser);
            sessionStorage.setItem('wolf_nick', currentNickname);
            sessionStorage.setItem('wolf_admin', data.isAdmin ? '1' : '0');
            if (data.token) {
                userToken = data.token;
                localStorage.setItem('wolf_token', userToken);
            }
            if (data.adminToken) {
                adminToken = data.adminToken;
                sessionStorage.setItem('wolf_admin_token', adminToken);
            }
            showAdminEntry(!!data.isAdmin);
            enterLobby();
            showUpdateNotice();
        } else {
            showMsg(data.msg, true);
        }
    }
    function logout() {
        sessionStorage.removeItem('wolf_user');
        localStorage.removeItem('wolf_token');
        userToken = '';
        sessionStorage.removeItem('wolf_admin');
        sessionStorage.removeItem('wolf_admin_token');
        adminToken = '';
        showAdminEntry(false);
        sessionStorage.removeItem('wolf_room');
        if (currentRoomId) socket.emit('leaveRoom', { roomId: currentRoomId, user: currentUser });
        location.href = location.pathname;
    }
    let adminToken = sessionStorage.getItem('wolf_admin_token') || '';
    let userToken = localStorage.getItem('wolf_token') || '';

    function showAdminEntry(on) {
        const b = document.getElementById('admin-btn');
        if (b) b.style.display = on ? 'inline-block' : 'none';
    }
    function restoreAdminEntry() {
        adminToken = sessionStorage.getItem('wolf_admin_token') || '';
        showAdminEntry(sessionStorage.getItem('wolf_admin') === '1' && !!adminToken);
    }

    function admToast(text) {
        let t = document.getElementById('adm-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'adm-toast';
            document.body.appendChild(t);
        }
        t.innerText = text;
        t.className = 'show';
        clearTimeout(admToast._timer);
        admToast._timer = setTimeout(function () { t.className = ''; }, 2200);
    }

    function admEsc(x) {
        return String(x === null || x === undefined ? '' : x)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function admApi(path, body) {
        const opt = { cache: 'no-store', headers: { 'x-admin-token': adminToken } };
        if (body) {
            opt.method = 'POST';
            opt.headers['Content-Type'] = 'application/json';
            opt.body = JSON.stringify(body);
        }
        try {
            const res = await fetch(path + '?t=' + encodeURIComponent(adminToken), opt);
            if (!res.ok) return { ok: false, msg: '服务器返回 HTTP ' + res.status };
            return await res.json();
        } catch (e) {
            return { ok: false, msg: '连不上服务器：' + e.message };
        }
    }

    function openAdminPanel() {
        if (!adminToken) return admToast('管理状态已失效，请退出后重新登录');
        document.getElementById('lobby-view').style.display = 'none';
        document.getElementById('room-view').style.display = 'none';
        document.getElementById('rank-view').style.display = 'none';
        document.getElementById('action-panel').style.display = 'none';
        document.getElementById('admin-view').style.display = 'block';
        loadAdminOverview();
    }

    function closeAdminPanel() { backToLobby(); }

    async function loadAdminOverview() {
        const d = await admApi('/api/admin/overview');
        if (!d.ok) { admToast(d.msg || '读取失败'); return; }
        try { renderAdminAccounts(d.accounts || []); }
        catch (e) { admToast('账号列表出错：' + e.message); }
        try { renderAdminRooms(d.rooms || []); }
        catch (e) { admToast('对局列表出错：' + e.message); }
    }

    function admLabel(text) {
        const el = document.createElement('div');
        el.className = 'adm-edit-label';
        el.innerText = text;
        return el;
    }

    function renderAdminAccounts(list) {
        const box = document.getElementById('adm-list');
        const cnt = document.getElementById('adm-count');
        box.innerHTML = '';
        if (cnt) cnt.innerText = list.length ? ' [' + list.length + ']' : '';
        if (!list.length) {
            box.innerHTML = '<div class="adm-empty">还没有账号</div>';
            return;
        }
        list.forEach(function (a) {
            const row = document.createElement('div');
            row.className = 'adm-row';

            const nameRow = document.createElement('div');
            nameRow.className = 'adm-name-row';

            const name = document.createElement('span');
            name.className = 'adm-name';
            name.innerText = a.nickname;
            nameRow.appendChild(name);

            if (a.username !== a.nickname) {
                const tag = document.createElement('span');
                tag.className = 'adm-tag';
                tag.innerText = a.username;
                nameRow.appendChild(tag);
            }
            if (a.isAdmin) {
                const tag = document.createElement('span');
                tag.className = 'adm-tag';
                tag.innerText = '管理员';
                nameRow.appendChild(tag);
            }

            const stat = document.createElement('span');
            stat.className = 'adm-stat';
            stat.innerText = (a.wins || 0) + ' 胜 / ' + (a.total || 0) + ' 场';
            nameRow.appendChild(stat);
            row.appendChild(nameRow);

            const ops = document.createElement('div');
            ops.className = 'adm-ops';

            const editBtn = document.createElement('button');
            editBtn.className = 'adm-pri';
            editBtn.innerText = '改资料';

            const delBtn = document.createElement('button');
            delBtn.className = 'adm-danger';
            delBtn.innerText = '删除';
            if (a.isAdmin) {
                delBtn.innerText = '不可删除';
                delBtn.disabled = true;
            }

            ops.appendChild(editBtn);
            ops.appendChild(delBtn);
            row.appendChild(ops);

            const edit = document.createElement('div');
            edit.className = 'adm-edit';

            edit.appendChild(admLabel('昵称'));
            const nickIn = document.createElement('input');
            nickIn.type = 'text';
            nickIn.maxLength = 12;
            nickIn.placeholder = '对外显示的昵称';
            nickIn.value = a.nickname;
            edit.appendChild(nickIn);

            const two = document.createElement('div');
            two.className = 'adm-edit-2';

            const winWrap = document.createElement('div');
            winWrap.appendChild(admLabel('获胜场次'));
            const winIn = document.createElement('input');
            winIn.type = 'number';
            winIn.min = '0';
            winIn.placeholder = '0';
            winIn.value = String(a.wins || 0);
            winWrap.appendChild(winIn);

            const totWrap = document.createElement('div');
            totWrap.appendChild(admLabel('总场次'));
            const totIn = document.createElement('input');
            totIn.type = 'number';
            totIn.min = '0';
            totIn.placeholder = '0';
            totIn.value = String(a.total || 0);
            totWrap.appendChild(totIn);

            two.appendChild(winWrap);
            two.appendChild(totWrap);
            edit.appendChild(two);

            const saveBtn = document.createElement('button');
            saveBtn.className = 'adm-pri';
            saveBtn.innerText = '保存资料';
            saveBtn.onclick = function () {
                admAction('save', a.id, {
                    nickname: nickIn.value.trim(),
                    wins: winIn.value,
                    total: totIn.value
                });
            };
            edit.appendChild(saveBtn);

            edit.appendChild(admLabel('重置密码'));
            const pwdIn = document.createElement('input');
            pwdIn.type = 'text';
            pwdIn.maxLength = 32;
            pwdIn.autocomplete = 'off';
            pwdIn.placeholder = '输入新密码[4-32 位]';
            edit.appendChild(pwdIn);

            const pwdBtn = document.createElement('button');
            pwdBtn.innerText = '改密码';
            pwdBtn.onclick = function () {
                const v = pwdIn.value.trim();
                if (v.length < 4) return admToast('密码至少 4 位');
                uiConfirm('把 [' + a.username + '] 的密码改成 ' + v + ' ？', function () {
                    admAction('password', a.id, { password: v });
                });
            };
            edit.appendChild(pwdBtn);

            row.appendChild(edit);

            editBtn.onclick = function () {
                const open = edit.style.display !== 'block';
                edit.style.display = open ? 'block' : 'none';
                editBtn.innerText = open ? '收起' : '改资料';
                if (open) setTimeout(function () { row.scrollIntoView({ block: 'nearest' }); }, 60);
            };

            delBtn.onclick = function () {
                if (a.isAdmin) return;
                uiConfirm('确定删除账号 [' + a.username + '] ？', function () { admAction('delete', a.id); });
            };

            box.appendChild(row);
        });
    }

    function renderAdminRooms(list) {
        const box = document.getElementById('adm-rooms');
        box.innerHTML = '';
        if (!list.length) {
            box.innerHTML = '<div class="adm-empty">现在没有房间在开</div>';
            return;
        }
        list.forEach(function (r) {
            const line = document.createElement('div');
            line.className = 'adm-roomline';
            const STATE_NAME = {
                waiting: '等待中', starting: '开局中', night: '夜晚', dawn: '天亮',
                day_discuss: '白天讨论', day_vote: '投票中', hunter_shoot: '猎人开枪', gameover: '已结束'
            };
            line.innerHTML = '<span>房间 ' + admEsc(r.id) + '</span><span>'
                + (STATE_NAME[r.state] || r.state) + ' · ' + r.count + '/' + r.max + ' 人</span>';
            box.appendChild(line);
        });
    }

    async function admAction(op, id, extra) {
        const body = Object.assign({ op: op }, extra || {});
        if (id !== undefined && id !== null) body.id = id;
        const d = await admApi('/api/admin/action', body);
        admToast(d.msg || (d.ok ? '已完成' : '操作失败'));
        if (d.ok) loadAdminOverview();
    }

    function admBatch(op, tip) {
        uiConfirm(tip, function () { admAction(op); });
    }

    function enterLobby() {
        setTimeout(refreshRooms, 80);
        if (currentUser) socket.emit('identify', { token: userToken, nickname: currentNickname || currentUser });
        closeAuth();
        document.getElementById('top-login-btn').style.display = 'none';
        document.querySelector('.intro-container').style.display = 'none';
        document.getElementById('game-section').style.display = 'flex';
        document.getElementById('cur-user').innerText = currentNickname || currentUser;

        if (currentRoomId) {
            document.getElementById('lobby-view').style.display = 'none';
            document.getElementById('room-view').style.display = 'block';
            document.getElementById('show-room-id').innerText = currentRoomId;
        } else {
            backToLobby();
        }
    }
    function backToLobby() {
        sessionStorage.removeItem('wolf_room');
        currentRoomId = '';
        document.getElementById('lobby-view').style.display = 'block';
        document.getElementById('room-view').style.display = 'none';
        document.getElementById('rank-view').style.display = 'none';
        var admView = document.getElementById('admin-view');
        if (admView) admView.style.display = 'none';
        var friView = document.getElementById('friends-view');
        if (friView) friView.style.display = 'none';
        document.getElementById('action-panel').style.display = 'none';
        isReady = false;
        currentNightStep = '';
        witchPendingKill = '';
        hunterName = '';
        lastGuardTarget = '';
        hostText = '';
        hostQueue.length = 0;
        if (hostTimer) { clearTimeout(hostTimer); hostTimer = null; }
        hostShowing = false;
        lastListSig = '';
        const lobbyTitle = document.getElementById('lobby-card-title');
        if (lobbyTitle) lobbyTitle.innerText = '创 建 或 加 入 一 场 对 局';
        document.body.classList.remove('night-mode');
    }
    function leaveRoom() {
        if (voiceOn || voiceStream || voicePeers.size) stopVoice(true);
        setRoomTab('main');
        const keepRoom = currentPhase !== 'waiting' && currentRoomId;
        const roomId = currentRoomId;
        socket.emit('leaveRoom', { roomId: currentRoomId, user: currentUser });
        clearRoomState();
        backToLobby();
        if (keepRoom) {
            document.getElementById('join-id').value = roomId;
            const tip = document.getElementById('lobby-card-title');
            if (tip) tip.innerText = '本局还没结束，输入房间码可回到对局';
        }
    }
    async function refreshRooms() {
        if (document.hidden) return;
        const lobby = document.getElementById('lobby-view');
        if (!lobby || lobby.style.display === 'none') return;
        try {
            const res = await fetch('/api/rooms');
            const data = await res.json();
            document.getElementById('rb-online').innerText = (data.online || 0) + ' 人';
            const ol = document.getElementById('rb-online-list');
            if (!data.onlinePlayers || data.onlinePlayers.length === 0) {
                ol.innerHTML = '<span class="rb-empty">暂无在线玩家</span>';
            } else {
                ol.innerHTML = data.onlinePlayers.map(function (p) {
                    return '<span class="rb-on' + (p.roomId ? ' in-room' : '') + '">'
                        + p.name + ' <span class="where">'
                        + (p.roomId ? '房间 ' + p.roomId : '大厅') + '</span></span>';
                }).join('');
            }
            const list = document.getElementById('rb-list');
            if (!data.rooms || data.rooms.length === 0) {
                list.innerHTML = '<li class="rb-empty">暂无打开的房间</li>';
                return;
            }
            list.innerHTML = data.rooms.map(function (r) {
                const stateText = r.state === 'waiting' ? '等待中'
                    : (r.state === 'gameover' ? '已结束' : '对局中');
                const stateCls = r.state === 'waiting' ? '' : (r.state === 'gameover' ? ' gone' : ' live');
                const names = r.players.map(function (p) {
                    const mark = p.bot ? '[bot]' : (p.away ? '[已离开]' : (p.online ? '' : '[掉线]'));
                    return '<span' + (mark ? ' class="off"' : '') + '>'
                        + (p.host ? '★' : '') + p.name + (mark ? ' ' + mark : '') + '</span>';
                }).join('、');
                const sel = (selectedRoomId === r.id) ? ' selected' : '';
                return '<li class="rb-item' + sel + '" data-id="' + r.id + '">'
                    + '<div class="rb-body"><div class="rb-top"><span class="rb-id">' + r.id + '</span>'
                    + '<span class="rb-state' + stateCls + '">' + stateText + '</span>'
                    + '<span class="rb-count">' + r.players.length + '/' + r.maxPlayers + '</span></div>'
                    + '<div class="rb-names">' + names + '</div></div>'
                    + '<button class="rb-join" type="button">加入</button></li>';
            }).join('');
            const stillThere = data.rooms.some(function (r) { return r.id === selectedRoomId; });
            if (!stillThere) selectedRoomId = '';
            Array.prototype.forEach.call(list.querySelectorAll('.rb-item'), function (el) {
                el.onclick = function () {
                    selectedRoomId = el.dataset.id;
                    document.getElementById('join-id').value = selectedRoomId;
                    list.querySelectorAll('.rb-item').forEach(function (x) { x.classList.remove('selected'); });
                    el.classList.add('selected');
                    document.getElementById('lobby-card-title').innerText = '已选择房间 ' + selectedRoomId + '，点右侧「加入」';
                };
                const jb = el.querySelector('.rb-join');
                if (jb) jb.onclick = function (e) {
                    e.stopPropagation();
                    const id = el.dataset.id;
                    if (id) doJoinRoom(id);
                };
            });
        } catch (e) { }
    }
    setInterval(refreshRooms, 4000);

    function avatarPlaceholder(name) {
        const ch = String(name || '?').trim().slice(0, 1) || '?';
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">'
            + '<rect width="96" height="96" fill="#dfe7e0"/>'
            + '<text x="48" y="63" font-size="40" fill="#1c2a23" text-anchor="middle" font-family="serif">'
            + ch + '</text></svg>';
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    let cardTarget = '';

    function canInviteToRoom() {
        const r = lastRoomData;
        return !!(currentUser && currentRoomId && r && r.state === 'waiting'
            && r.players && r.players.length < r.maxPlayers);
    }

    function inviteFriend(name) {
        if (!name) return;
        if (!currentRoomId) return uiAlert('先进一个房间，再邀请好友');
        if (!canInviteToRoom()) return uiAlert('房间已经开始或已经满员，暂时不能邀请');
        socket.emit('inviteFriend', { roomId: currentRoomId, target: name });
    }

    function cardInvite() {
        if (!cardTarget) return;
        inviteFriend(cardTarget);
    }

    async function openCard(name) {
        if (!name) return;
        if (name === currentUser) return openProfile();
        const d = await getJson('/api/card?user=' + encodeURIComponent(name) + '&me=' + encodeURIComponent(currentUser));
        if (!d || !d.ok) return uiAlert((d && d.msg) || '读取失败');
        const c = d.card;
        cardTarget = c.user;
        document.getElementById('card-nick').innerText = c.nickname;
        document.getElementById('card-sub').innerText =
            (c.isAdmin ? '管理员' : '玩家') + ' · ' + (c.online ? '在线' : '离线');
        document.getElementById('card-stats').innerText = c.wins + ' 胜 / ' + c.total + ' 场'
            + (c.total > 0 ? '　胜率 ' + Math.round(c.wins / c.total * 100) + '%' : '　还没打完一局');
        const signEl = document.getElementById('card-sign');
        signEl.innerText = c.signature || '还没有写个性签名';
        signEl.className = 'card-sign' + (c.signature ? '' : ' empty');
        const histEl = document.getElementById('card-history');
        const hist = c.history || [];
        if (hist.length) {
            histEl.innerHTML = hist.map(function (h) {
                const d = new Date(h.endedAt || 0);
                const ds = (d.getMonth() + 1) + '/' + d.getDate();
                const result = h.win ? '<span class="card-hist-win">胜</span>' : '<span class="card-hist-loss">负</span>';
                return '<div class="card-hist-row"><span class="card-hist-role">' + escHtml(h.role || '未知')
                    + '</span><span class="card-hist-date">' + ds + '</span>' + result + '</div>';
            }).join('');
        } else {
            histEl.innerHTML = '<div class="card-hist-empty">近 10 场还没有记录</div>';
        }
        document.getElementById('card-avatar').src = c.avatar || avatarPlaceholder(c.nickname);
        const btn = document.getElementById('card-fri-btn');
        btn.style.display = 'block';
        btn.disabled = false;
        if (c.isFriend) {
            btn.dataset.mode = 'remove'; btn.innerText = '移除好友';
        } else if (c.friendReq === 'out') {
            btn.dataset.mode = 'pending'; btn.innerText = '申请已发送'; btn.disabled = true;
        } else if (c.friendReq === 'in') {
            btn.dataset.mode = 'confirm'; btn.innerText = '对方已申请你';
        } else {
            btn.dataset.mode = 'add'; btn.innerText = '加为好友';
        }
        document.getElementById('card-pm-btn').style.display = c.isFriend ? 'block' : 'none';
        document.getElementById('card-invite-btn').style.display = (c.isFriend && canInviteToRoom()) ? 'block' : 'none';
        document.getElementById('card-modal').style.display = 'flex';
    }
    function closeCard() { document.getElementById('card-modal').style.display = 'none'; }

    async function cardFriendAction() {
        const btn = document.getElementById('card-fri-btn');
        if (!cardTarget) return;
        const mode = btn.dataset.mode;
        if (mode === 'pending') return uiAlert('申请已经发出去了，等对方确认');
        if (mode === 'confirm') { closeCard(); return showFriends(); }
        const d = await postJson('/api/friend/' + (mode === 'remove' ? 'remove' : 'add'), { user: currentUser, target: cardTarget });
        if (!d || !d.ok) return uiAlert((d && d.msg) || '操作失败');
        if (mode === 'remove') {
            btn.dataset.mode = 'add'; btn.innerText = '加为好友';
        } else {
            btn.dataset.mode = 'pending'; btn.innerText = '申请已发送'; btn.disabled = true;
        }
        uiAlert(d.msg || '已处理');
    }

    function openQQ() {
        const qq = '3693257606';
        let fell = false;
        const onBlur = function () { fell = true; clearTimeout(timer); };
        window.addEventListener('blur', onBlur, { once: true });
        const timer = setTimeout(function () {
            window.removeEventListener('blur', onBlur);
            if (fell) return;
            uiAlert('没有拉起 QQ，可能是 QQ 不是最新版本，或者浏览器拦了跳转');
        }, 1800);
        location.href = 'mqq://im/chat?chat_type=wpa&uin=' + qq + '&version=1&src_type=web';
    }

    let pmPeer = '', pmPeerNick = '', pmOldest = 0, pmMore = false, pmMsgs = [];
    function escHtml(t) {
        return String(t).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function pmTime(ts) {
        const d = new Date(ts || 0);
        let h = d.getHours(), m = d.getMinutes();
        return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
    }

    async function openPm(peer, nick) {
        if (!peer || peer === currentUser) return;
        pmPeer = peer;
        pmPeerNick = nick || peer;
        pmOldest = 0;
        pmMore = false;
        pmMsgs = [];
        document.getElementById('card-modal').style.display = 'none';
        document.getElementById('pm-modal').style.display = 'flex';
        document.getElementById('pm-peer').innerText = pmPeerNick;
        document.getElementById('pm-text').value = '';
        document.getElementById('pm-body').innerHTML = '<div class="pm-empty">正在读取</div>';
        await loadPm();
    }
    function closePm() { document.getElementById('pm-modal').style.display = 'none'; pmPeer = ''; }

    function pmLines(list) {
        return list.map(function (m) {
            return '<div class="pm-line' + (m.mine ? ' me' : '') + '">'
                + '<div class="pm-bubble">' + escHtml(m.text) + '</div>'
                + '<div class="pm-tm">' + pmTime(m.t) + '</div></div>';
        }).join('');
    }

    function renderPm() {
        const box = document.getElementById('pm-body');
        if (!box) return;
        if (!pmMsgs.length) {
            box.innerHTML = '<div class="pm-empty">还没有聊天，打个招呼吧</div>';
            return;
        }
        box.innerHTML = (pmMore ? '<div class="pm-more" onclick="loadPm(true)">查看更早的记录</div>' : '')
            + pmLines(pmMsgs);
    }

    async function loadPm(older) {
        if (!pmPeer) return;
        const box = document.getElementById('pm-body');
        const url = '/api/pm/thread?user=' + encodeURIComponent(currentUser)
            + '&peer=' + encodeURIComponent(pmPeer)
            + (older && pmOldest ? '&before=' + pmOldest : '');
        const d = await getJson(url);
        if (!d || !d.ok) { box.innerHTML = '<div class="pm-empty">' + escHtml((d && d.msg) || '读取失败') + '</div>'; return; }
        if (!d.list.length) {
            if (!older) renderPm();
            return;
        }
        pmOldest = d.list[0].id;
        pmMore = !!d.hasMore;
        const keep = older ? (box.scrollHeight - box.scrollTop) : 0;
        pmMsgs = older ? d.list.concat(pmMsgs) : d.list;
        renderPm();
        box.scrollTop = older ? (box.scrollHeight - keep) : box.scrollHeight;
    }

    async function sendPm() {
        if (!pmPeer) return;
        const inp = document.getElementById('pm-text');
        const text = String(inp.value || '').trim();
        if (!text) return;
        inp.value = '';
        const d = await postJson('/api/pm/send', { user: currentUser, to: pmPeer, text: text });
        if (!d || !d.ok) { uiAlert((d && d.msg) || '发送失败'); inp.value = text; return; }
        loadPm();
    }

    async function showFriends() {
        document.getElementById('lobby-view').style.display = 'none';
        document.getElementById('room-view').style.display = 'none';
        document.getElementById('rank-view').style.display = 'none';
        var av = document.getElementById('admin-view');
        if (av) av.style.display = 'none';
        document.getElementById('friends-view').style.display = 'block';
        document.getElementById('fri-search').value = '';
        loadFriends();
    }

    async function loadFriends() {
        const box = document.getElementById('fri-list');
        if (!currentUser) return;
        const d = await getJson('/api/friends?user=' + encodeURIComponent(currentUser));
        if (!d || !d.ok) { box.innerHTML = '<div class="adm-empty">' + ((d && d.msg) || '读取失败') + '</div>'; return; }
        document.getElementById('fri-count').innerText = d.list.length + '位';
        if (!d.list.length) {
            box.innerHTML = '<div class="adm-empty">还没有好友，在房间里点别人的头像就能加</div>';
            return;
        }
        box.innerHTML = d.list.map(function (f) {
            const unread = f.unread ? '<span class="fri-unread">' + f.unread + '</span>' : '';
            return '<div class="fri-row">'
                + '<img class="avatar-sm" src="' + (f.avatar || avatarPlaceholder(f.nickname)) + '" alt="">'
                + '<div class="fri-main"><span class="fri-name" data-n="' + f.nickname + '">' + f.nickname + '</span>'
                + (f.signature ? '<span class="fri-sign">' + escHtml(f.signature) + '</span>' : '')
                + '</div>'
                + unread
                + '<span class="fri-state' + (f.online ? ' on' : '') + '">' + (f.online ? '在线' : '离线') + '</span>'
                + (canInviteToRoom() ? '<span class="fri-act" data-inv="' + f.user + '">邀请</span>' : '')
                + '<span class="fri-act" data-pm="' + f.user + '">聊天</span>'
                + '<span class="fri-act" data-u="' + f.user + '">名片</span></div>';
        }).join('');
        loadFriendRequests();
        Array.prototype.forEach.call(box.querySelectorAll('.fri-act'), function (el) {
            if (el.dataset.pm) {
                const nm = el.parentNode.querySelector('.fri-name');
                el.onclick = function () { openPm(el.dataset.pm, nm ? nm.innerText : el.dataset.pm); };
            } else if (el.dataset.inv) {
                el.onclick = function () { inviteFriend(el.dataset.inv); };
            } else {
                el.onclick = function () { openCard(el.dataset.u); };
            }
        });
    }

    async function loadFriendRequests() {
        const box = document.getElementById('fri-req-list');
        const title = document.getElementById('fri-req-title');
        if (!box || !currentUser) return;
        let d = null;
        try { d = await getJson('/api/friend/requests?user=' + encodeURIComponent(currentUser)); } catch (e) { }
        const list = (d && d.ok && d.list) || [];
        if (!list.length) {
            box.style.display = 'none';
            box.innerHTML = '';
            if (title) title.style.display = 'none';
            return;
        }
        box.style.display = 'block';
        if (title) title.style.display = 'block';
        box.innerHTML = list.map(function (r) {
            return '<div class="fri-req" data-id="' + r.id + '">'
                + '<img src="' + (r.avatar || avatarPlaceholder(r.nickname)) + '" alt="">'
                + '<span class="fri-req-name">' + escHtml(r.nickname) + ' 想加你为好友</span>'
                + '<button class="fri-req-act ok" data-act="ok">同意</button>'
                + '<button class="fri-req-act no" data-act="no">拒绝</button></div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('.fri-req-act'), function (el) {
            el.onclick = async function () {
                const row = el.closest('.fri-req');
                const id = parseInt(row.dataset.id, 10);
                const d2 = await postJson('/api/friend/' + (el.dataset.act === 'ok' ? 'accept' : 'reject'), { user: currentUser, id: id });
                if (!d2 || !d2.ok) return uiAlert((d2 && d2.msg) || '操作失败');
                loadFriends();
            };
        });
    }

    async function addFriendByName() {
        const inp = document.getElementById('fri-search');
        const name = String(inp.value || '').trim();
        if (!name) return uiAlert('输入对方的账号名');
        if (name === currentUser) return uiAlert('不能加自己');
        const d = await postJson('/api/friend/add', { user: currentUser, target: name });
        if (!d || !d.ok) return uiAlert((d && d.msg) || '添加失败');
        inp.value = '';
        uiAlert(d.msg || '好友申请已发送');
        loadFriends();
    }

    function compressImage(file, size, cb) {
        const reader = new FileReader();
        reader.onload = function () {
            const img = new Image();
            img.onload = function () {
                try {
                    const s = Math.min(img.width, img.height);
                    const cv = document.createElement('canvas');
                    cv.width = size; cv.height = size;
                    cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
                    cb(cv.toDataURL('image/jpeg', 0.82));
                } catch (e) { cb(''); }
            };
            img.onerror = function () { cb(''); };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    function roomCodeScore(a, b) {
        let same = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
        return same;
    }
    function lobbyTip(text) {
        const t = document.getElementById('lobby-card-title');
        if (t) t.innerText = text;
    }
    async function fetchRoomList() {
        try {
            const d = await getJson('/api/rooms');
            return (d && d.rooms) || [];
        } catch (e) { return null; }
    }
    function doJoinRoom(rid) {
        clearRoomState();
        currentRoomId = String(rid).trim();
        sessionStorage.setItem('wolf_room', currentRoomId);
        document.getElementById('lobby-view').style.display = 'none';
        document.getElementById('room-view').style.display = 'block';
        document.getElementById('show-room-id').innerText = currentRoomId;
        socket.emit('joinRoom', { roomId: currentRoomId, user: currentUser, nickname: currentNickname || currentUser });
    }
    async function quickJoin() {
        const rooms = await fetchRoomList();
        if (!rooms) return lobbyTip('连不上服务器，稍后再试');
        let best = null;
        rooms.forEach(function (r) {
            if (r.state !== 'waiting') return;
            if (!r.players.length) return;
            if (r.players.length >= r.maxPlayers) return;
            if (!best || r.players.length > best.players.length) best = r;
        });
        if (!best) {
            lobbyTip('暂时没有能进的房间，正在给你开一间');
            createRoom();
            return;
        }
        lobbyTip('已匹配到房间 ' + best.id + '，正在进入');
        doJoinRoom(best.id);
    }

    function createRoom() { socket.emit('createRoom', { user: currentUser, nickname: currentNickname || currentUser }); }
    socket.on('friendAlert', function (d) {
        if (!d) return;
        if (d.type === 'request') uiAlert(d.from + ' 想加你为好友，去「好友」里同意');
        else if (d.type === 'accepted') uiAlert(d.from + ' 同意了你的好友申请');
        if (document.getElementById('friends-view').style.display !== 'none') loadFriends();
    });

    socket.on('roomInvite', function (d) {
        if (!d || !d.roomId) return;
        const who = d.fromNickname || d.from || '好友';
        uiConfirm(who + ' 邀请你加入房间 ' + d.roomId + '（' + (d.playerCount || 0) + '/' + (d.maxPlayers || 6) + '），现在加入吗？',
            function () {
                socket.emit('inviteReply', { to: d.from, roomId: d.roomId, accepted: true });
                doJoinRoom(d.roomId);
            },
            function () {
                socket.emit('inviteReply', { to: d.from, roomId: d.roomId, accepted: false });
                uiAlert('已拒绝这次房间邀请');
            });
    });

    socket.on('inviteResult', function (d) {
        if (d && d.msg) uiAlert(d.msg);
    });

    socket.on('joinDenied', function (d) {
        sessionStorage.removeItem('wolf_room');
        currentRoomId = '';
        backToLobby();
        uiAlert((d && d.reason) || '房主拒绝了你加入该房间');
    });

    socket.on('pmAlert', function (d) {
        if (!d) return;
        if (pmPeer === d.from) { loadPm(); return; }
        if (document.getElementById('friends-view').style.display !== 'none') loadFriends();
    });

    socket.on('roomCreated', function (roomId) {
        clearRoomState();
        currentRoomId = roomId;
        sessionStorage.setItem('wolf_room', currentRoomId);
        document.getElementById('lobby-view').style.display = 'none';
        document.getElementById('room-view').style.display = 'block';
        document.getElementById('show-room-id').innerText = roomId;
        socket.emit('joinRoom', { roomId: roomId, user: currentUser, nickname: currentNickname || currentUser });
    });
    async function joinRoom() {
        const raw = document.getElementById('join-id').value;
        const rid = String(raw || '').trim().replace(/[^0-9]/g, '');
        if (!rid) return lobbyTip('先输入 6 位房间码');
        if (rid.length !== 6) return lobbyTip('房间码是 6 位数字，检查一下');

        const rooms = await fetchRoomList();
        if (!rooms) return doJoinRoom(rid);
        if (rooms.some(function (r) { return r.id === rid; })) return doJoinRoom(rid);

        let best = null, bestScore = 0;
        rooms.forEach(function (r) {
            const score = roomCodeScore(rid, r.id);
            if (score > bestScore) { bestScore = score; best = r; }
        });
        if (best && bestScore >= 4) {
            uiConfirm('没有 ' + rid + ' 这个房间，最接近的是 ' + best.id + '，要进这个吗？', function () {
                document.getElementById('join-id').value = best.id;
                doJoinRoom(best.id);
            });
            return;
        }
        lobbyTip('没有 ' + rid + ' 这个房间，对照一下房间页上的码');
    }
    function toggleReady() {
        isReady = !isReady;
        const btn = document.getElementById('ready-btn');
        btn.innerText = isReady ? '取消准备' : '准备就绪';
        btn.classList.toggle('is-ready', isReady);

        if (lastRoomData) {
            const me = lastRoomData.players.find(function (p) { return p.name === currentUser; });
            if (me) { me.isReady = isReady; applyRoomUpdate(lastRoomData); }
        }
        socket.emit('toggleReady', { roomId: currentRoomId, user: currentUser, ready: isReady });
    }
    let phaseDeadline = null;
    let myVoteTarget = '';

    let myMarks = {};
    let marksRoomTag = '';
    function marksKey() { return 'wolfMark_' + currentRoomId + '_' + currentUser; }
    function loadMarks() {
        const tag = currentRoomId + '_' + currentUser;
        if (tag === marksRoomTag) return;
        marksRoomTag = tag;
        try { myMarks = JSON.parse(localStorage.getItem(marksKey()) || '{}') || {}; }
        catch (e) { myMarks = {}; }
    }
    function saveMarks() {
        try { localStorage.setItem(marksKey(), JSON.stringify(myMarks)); } catch (e) {}
    }
    function markOf(name) { return myMarks[name] || ''; }

    const AV_DEFAULT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        + '<rect width="24" height="24" fill="#e4eae5"/>'
        + '<circle cx="12" cy="9.2" r="3.7" fill="#8c928d"/>'
        + '<path d="M4.2 21.4c1.3-4.4 4.3-6.6 7.8-6.6s6.5 2.2 7.8 6.6z" fill="#8c928d"/></svg>');
    const MARK_TAG_SVG = '<svg class="p-mark-tag" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M3.2 12.6l9.4-9.4h8.2v8.2l-9.4 9.4z"/>'
        + '<circle cx="17.2" cy="6.8" r="1.4"/></svg>';
    const MARK_OPTS = [
        { k: 'wolf',     t: '狼人',   s: '狼' },
        { k: 'good',     t: '好人',   s: '好' },
        { k: 'villager', t: '平民',   s: '民' },
        { k: 'seer',     t: '预言家', s: '预' },
        { k: 'witch',    t: '女巫',   s: '女' },
        { k: 'hunter',   t: '猎人',   s: '猎' },
        { k: 'guard',    t: '守卫',   s: '守' }
    ];
    function markLabel(k) {
        const o = MARK_OPTS.find(x => x.k === k);
        return o ? o.t : '';
    }

    function closeMarkMenu() {
        const m = document.getElementById('mark-menu');
        if (m) m.classList.remove('show');
    }
    function setMark(name, k) {
        if (!k) delete myMarks[name];
        else myMarks[name] = k;
        saveMarks();
        closeMarkMenu();
        if (lastRoomData) applyRoomUpdate(lastRoomData);
    }
    function openMarkMenu(name, el) {
        const menu = document.getElementById('mark-menu');
        if (!menu) return;
        const cur = markOf(name);
        menu.innerHTML = '';
        const title = document.createElement('div');
        title.style.cssText = 'flex:1 1 100%;font-size:11.5px;color:var(--text-dim);padding:2px 2px 4px;';
        title.innerText = '标记 ' + nickOf(name) + '（只有你自己能看到）';
        menu.appendChild(title);
        MARK_OPTS.forEach(o => {
            const b = document.createElement('button');
            b.innerText = o.t;
            b.className = cur === o.k ? 'act' : '';
            b.onclick = function (e) { e.stopPropagation(); setMark(name, o.k); };
            menu.appendChild(b);
        });
        const clr = document.createElement('button');
        clr.innerText = '清除标记';
        clr.style.cssText = 'flex:1 1 100%;color:var(--text-sub);';
        clr.onclick = function (e) { e.stopPropagation(); setMark(name, ''); };
        menu.appendChild(clr);

        menu.classList.add('show');
        const r = el.getBoundingClientRect();
        const mw = 198, mh = menu.offsetHeight || 200;
        let left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
        let top = r.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }
    document.addEventListener('click', function (e) {
        const menu = document.getElementById('mark-menu');
        if (menu && menu.classList.contains('show') && !menu.contains(e.target)) closeMarkMenu();
    }, true);

    const pfFile = document.getElementById('pf-avatar-file');
    if (pfFile) {
        pfFile.addEventListener('change', function () {
            const file = this.files && this.files[0];
            if (!file) return;
            compressImage(file, 96, function (dataUrl) {
                if (!dataUrl) return pfMsg('这张图片读不出来，换一张试试', true);
                postJson('/api/avatar', { user: currentUser, data: dataUrl }).then(function (d) {
                    if (!d || !d.ok) return pfMsg((d && d.msg) || '头像上传失败', true);
                    document.getElementById('pf-avatar').src = dataUrl;
                    if (lastRoomData) {
                        const me = lastRoomData.players.find(function (p) { return p.name === currentUser; });
                        if (me) { me.avatar = dataUrl; applyRoomUpdate(lastRoomData); }
                    }
                    pfMsg('头像已更新', false);
                }).catch(function () { pfMsg('连不上服务器，头像没传到', true); });
            });
            this.value = '';
        });
    }

    function nudgeReady() {
        if (!currentRoomId) return;
        socket.emit('nudgeReady', { roomId: currentRoomId });
    }

    let startLock = false;
    function startGame() {
        if (startLock) return;
        startLock = true;
        setTimeout(function () { startLock = false; }, 2500);
        const forceRole = new URLSearchParams(location.search).get('role') || '';
        socket.emit('startGame', { roomId: currentRoomId, forceRole: forceRole });
    }
    function endGame() { socket.emit('endGameMock', currentRoomId); }
    let maxPlayersCur = 6;

    function paintMaxPlayers() {
        const el = document.getElementById('max-players-val');
        if (el) el.innerText = maxPlayersCur + ' 人';
    }
    function toggleDeepSeek() {
        if (!lastRoomData) return;
        const host = lastRoomData.players[0];
        if (!host || host.name !== currentUser) return uiAlert('只有房主可以开关 DeepSeek');
        if (!lastRoomData.dsReady) return uiAlert('服务器未配置 DeepSeek Key，请填写 data/APIKEY.key 后重启');
        socket.emit('toggleDeepSeek', { on: !lastRoomData.useDeepSeek });
    }

    function stepMaxPlayers(d) {
        const sizes = [4, 5, 6, 7, 8];
        const i = Math.max(0, sizes.indexOf(maxPlayersCur));
        const ni = Math.min(sizes.length - 1, Math.max(0, i + d));
        if (ni === i) return;
        maxPlayersCur = sizes[ni];
        paintMaxPlayers();
        socket.emit('setMaxPlayers', { roomId: currentRoomId, maxPlayers: maxPlayersCur });
    }
    function setMaxPlayers() {
        socket.emit('setMaxPlayers', { roomId: currentRoomId, maxPlayers: maxPlayersCur });
    }
    function fillBots() { socket.emit('debugFill', { roomId: currentRoomId }); }

    function sendChat() {
        if (!isAlive) return uiAlert('你已出局，请默默观战');
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (text) {
            if (currentPhase === 'night') {
                if (myRole === '狼人' && currentNightStep === 'wolf') {
                    socket.emit('wolfChat', { roomId: currentRoomId, user: currentUser, text: text });
                }
            } else {
                socket.emit('chat', { roomId: currentRoomId, user: currentUser, text: text });
            }
            input.value = '';
        }
    }

    function endDiscussion() {
        hasActed = true;
        socket.emit('endDiscussion', { roomId: currentRoomId, user: currentUser });
        setHostText('你已结束发言，等待其他玩家准备投票');
        document.getElementById('action-panel').style.display = 'none';
    }

    function copyRoomCode() {
        const code = document.getElementById('show-room-id').innerText;
        if (!code) return;
        navigator.clipboard.writeText(code).then(function () {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.innerText = '房间码已复制: ' + code;
            document.body.appendChild(toast);
            setTimeout(function () { toast.remove(); }, 2000);
        }).catch(function () {
            uiAlert('复制失败，请手动长按选择复制');
        });
    }

    function chatLine(data, kind) {
        const box = document.getElementById('chat-box');
        if (!box) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';
        const seatTag = seatOf(data.user);
        const who = (seatTag ? seatTag + ' ' : '') + (data.nickname || data.user);
        if (kind === 'wolf') {
            div.innerHTML = '<span class="wolf-chat">[狼队频道] ' + escHtml(who) + '：</span>' + escHtml(data.text);
        } else {
            div.innerHTML = '<span class="name' + (data.user === currentHostName ? ' host-name' : '') + '">'
                + escHtml(who) + '：</span>' + escHtml(data.text);
        }
        box.appendChild(div);
    }

    socket.on('chatHistory', function (list) {
        const box = document.getElementById('chat-box');
        if (!box || !list || !list.length) return;
        box.innerHTML = '';
        list.forEach(function (m) { chatLine(m, m.kind); });
        const hint = document.createElement('div');
        hint.className = 'chat-msg';
        hint.innerHTML = '<span class="sys">系统：</span>以上是服务器保存的聊天记录';
        box.appendChild(hint);
        box.scrollTop = box.scrollHeight;
    });

    socket.on('chat', function (data) {
        const box = document.getElementById('chat-box');
        chatLine(data, 'say');
        box.scrollTop = box.scrollHeight;
    });
    socket.on('wolfChat', function (data) {
        const box = document.getElementById('chat-box');
        chatLine(data, 'wolf');
        box.scrollTop = box.scrollHeight;
    });
    socket.on('systemMsg', function (msg) {
        const box = document.getElementById('chat-box');
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = '<span class="sys">系统：</span>' + hostHtml(msg);
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    });
    socket.on('typing', function (data) {
        const el = document.getElementById('typing-hint');
        if (!el) return;
        if (data && data.on) {
            el.innerText = data.name + ' 正在输入';
            el.style.display = 'block';
        } else {
            el.innerText = '';
            el.style.display = 'none';
        }
    });

    socket.on('privateMsg', function (msg) {
        const box = document.getElementById('chat-box');
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = '<span class="private">[小队内]</span>' + msg;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    });

    let barKey = '';
    function renderPhaseBar() {
        const line = document.getElementById('phase-line');
        const wrap = document.getElementById('phase-bar');
        const cnt = document.getElementById('phase-count');
        if (!line || !wrap) return;
        const live = phaseDeadline && lastRoomData
            && lastRoomData.state !== 'waiting' && lastRoomData.state !== 'gameover';
        const remain = live ? (phaseDeadline.at - Date.now()) / 1000 : 0;
        if (!live || remain <= 0.2) {
            barKey = '';
            line.classList.remove('on');
            wrap.innerHTML = '<i></i>';
            if (cnt) { cnt.innerText = ''; cnt.className = ''; }
            return;
        }

        line.classList.add('on');
        if (cnt) {
            cnt.innerText = Math.ceil(remain) + 's';
            cnt.className = remain <= 6 ? 'urgent' : '';
        }
        const key = String(phaseDeadline.at);
        if (key === barKey && wrap.firstChild) {
            wrap.firstChild.className = remain <= 6 ? 'urgent' : '';
            return;
        }
        barKey = key;
        wrap.innerHTML = '<i class="' + (remain <= 6 ? 'urgent' : '') + '" style="animation-duration:' + remain + 's"></i>';
    }

    function applyRoomUpdate(room) {
        if (room && room.state === 'waiting') {
            myRole = '';
            const badge = document.getElementById('my-role-badge');
            if (badge) badge.style.display = 'none';
        }
        loadMarks();

        lastRoomData = room;
        currentPhase = room.state;
        currentNightStep = room.nightStep || '';
        hunterName = room.hunterName || '';
        currentHostName = (room.players[0] && room.players[0].name) || '';

        const me = room.players.find(function (p) { return p.name === currentUser; });
        if (me) {
            isAlive = me.alive;
            hasActed = !!me.hasActed;
            const rt = document.getElementById('role-text');
            const badge = document.getElementById('my-role-badge');
            if (me.role && me.role !== '未分配') {
                myRole = me.role;
                rt.innerText = myRole;
                rt.style.color = (ROLE_UI_COLOR || {})[myRole] || '';
                badge.style.display = 'flex';
            } else {
                rt.innerText = '';
                badge.style.display = 'none';
            }
            const mateLine = document.getElementById('wolf-mate-line');
            if (mateLine) {
                if (me.role === '狼人') {
                    const mates = room.players.filter(function (p) { return p.role === '狼人' && p.name !== currentUser; })
                        .map(function (p) { return (p.seat || '') + ' ' + (p.nickname || p.name); });
                    mateLine.innerText = mates.length ? ' · 狼队友：' + mates.join('、') : ' · 本局只有你一只狼';
                } else {
                    mateLine.innerText = '';
                }
            }
        }

        const view = document.getElementById('room-view');
        if (view) view.classList.toggle('is-waiting', room.state === 'waiting');
        const pcEl = document.getElementById('pl-count');
        if (pcEl) pcEl.innerText = room.players.length + ' / ' + room.maxPlayers;

        const list = document.getElementById('player-list');
        list.innerHTML = '';
        list.classList.toggle('voting', room.state === 'day_vote');

        const listSig = room.players.map(function (p) { return p.name; }).join('|');
        const shouldAnimate = listSig !== lastListSig;
        lastListSig = listSig;

        let allReady = true;
        const isHost = room.players.length > 0 && room.players[0].name === currentUser;

        /* 房主调试按钮：每轮房间数据都重新计算，避免状态切换后按钮消失 */
        const fillBtn = document.getElementById('fill-btn');
        const endBtn = document.getElementById('end-btn');
        if (fillBtn) {
            fillBtn.style.display = (isHost && room.state === 'waiting') ? 'block' : 'none';
            fillBtn.disabled = room.players.length >= room.maxPlayers;
            fillBtn.innerText = fillBtn.disabled ? '房间已满' : '填充机器人';
        }
        if (endBtn) {
            endBtn.style.display = (isHost && room.state !== 'waiting' && room.state !== 'gameover')
                ? 'block' : 'none';
            endBtn.innerText = '强制结束';
        }
        const dsBtn = document.getElementById('ds-btn');
        if (dsBtn) {
            dsBtn.style.display = isHost ? 'inline-block' : 'none';
            dsBtn.innerText = 'AI：' + (room.useDeepSeek ? '开' : '关');
            dsBtn.classList.toggle('on', !!room.useDeepSeek);
            dsBtn.disabled = !room.dsReady;
            dsBtn.title = room.dsReady ? '房主可以随时开关 DeepSeek 聊天' : '服务器未配置 Key，暂时不能开启';
        }
        const voteCounts = {};
        if (room.state === 'day_vote' && room.votes) {
            Object.keys(room.votes).forEach(function (voter) {
                const t = room.votes[voter];
                if (t && t !== 'skip' && t !== 'undefined') voteCounts[t] = (voteCounts[t] || 0) + 1;
            });
        }
        room.players.forEach(function (p, idx) {
            const div = document.createElement('div');
            div.className = 'player-item';
            if (!p.alive) div.className += ' dead';
            if (p.name === currentUser) div.className += ' me';
            if (p.isBot) div.className += ' bot';
            if (p.role === '狼人' && myRole === '狼人' && p.name !== currentUser) div.className += ' wolf-mate';
            if (idx === 0 && !p.isBot) div.className += ' is-host';
            if (shouldAnimate) {
                div.className += ' enter';
                div.style.setProperty('--d', Math.min(idx, 8) * 32 + 'ms');
            }

            let roleDisplay = '';
            const spectating = !isAlive && room.state !== 'waiting';
            if (room.state === 'gameover' || spectating) {
                const wolfCls = p.role === '狼人' ? ' p-role wolf' : ' p-role';
                roleDisplay = ' <span class="' + wolfCls + '">' + p.role + '</span>';
            }

            let tag = '';
            if (p.away) tag = ' <span class="p-tag">暂时离开</span>';
            else if (!p.isConnected) tag = ' <span class="p-tag">掉线</span>';
            else if (p.isBot && room.state === 'waiting') tag = ' <span class="p-tag p-tag-bot">机器人</span>';
            else if (p.isReady && !(idx === 0 && room.state === 'waiting'))
                tag = ' <span class="p-tag p-tag-ready">已准备</span>';
            if (room.state === 'day_vote' && room.votes && room.votes[p.name]) {
                tag += ' <span class="vote-tag">已投</span>';
            }
            let countHtml = '';
            if (room.state === 'day_vote' && voteCounts[p.name]) {
                countHtml = '<span class="vote-count">' + voteCounts[p.name] + ' 票</span>';
            }
            if (p.away || !p.isConnected) div.className += ' offline';

            const showName = p.nickname || p.name;
            div.dataset.name = p.name;
            div.dataset.idx = String(idx);
            const barHtml = '';
            let markHtml = '';
            if (room.state !== 'waiting' && p.name !== currentUser) {
                const mk = markOf(p.name);
                markHtml = '<span class="p-mark' + (mk ? ' on-' + mk : ' empty') + '"'
                    + ' title="' + (mk ? markLabel(mk) : '标记') + '">' + (mk ? markLabel(mk) : MARK_TAG_SVG) + '</span>';
            }
            const tagHtml = tag ? '<span class="p-tags">' + tag + '</span>' : '';
            const mateTag = (p.role === '狼人' && myRole === '狼人' && p.name !== currentUser)
                ? '<span class="p-tags"><span class="p-tag p-tag-wolf">狼队友</span></span>' : '';
            const hasAvatar = !p.isBot && !!p.avatar;
            div.className += ' has-av';
            const avHtml = '<span class="p-avatar"' + (hasAvatar ? ' title="看名片"' : '')
                + '><img src="' + (hasAvatar ? p.avatar : AV_DEFAULT) + '" alt=""></span>';
            const seatTxt = p.seat || seatLetter(idx);
            div.innerHTML = avHtml + '<span class="p-main"><span class="p-speak" data-name="' + escHtml(p.name) + '"></span><span class="p-seat">' + escHtml(seatTxt) + '</span> '
                + '<span class="p-name">' + escHtml(showName) + '</span>'
                + roleDisplay + '</span>' + mateTag + tagHtml + countHtml + barHtml + markHtml;

            const avEl = div.querySelector('.p-avatar');
            if (avEl) avEl.onclick = function (e) { e.stopPropagation(); openCard(p.name); };

            const mkEl = div.querySelector('.p-mark');
            if (mkEl) mkEl.onclick = function (e) { e.stopPropagation(); openMarkMenu(p.name, mkEl); };

            if (isHost && idx > 0 && room.state === 'waiting') {
                const ops = document.createElement('span');
                ops.className = 'card-ops';

                if (!p.isBot && p.isConnected && !p.away) {
                    const tr = document.createElement('span');
                    tr.className = 'op-btn';
                    tr.innerText = '转让';
                    tr.onclick = function (e) {
                        e.stopPropagation();
                        uiConfirm('把房主转让给 ' + showName + '？', function () {
                            socket.emit('transferHost', { roomId: currentRoomId, target: p.name });
                        });
                    };
                    ops.appendChild(tr);
                }

                const kick = document.createElement('span');
                kick.className = 'op-btn op-danger';
                kick.innerText = '移出';
                kick.onclick = function (e) {
                    e.stopPropagation();
                    uiConfirm('确定把 ' + showName + ' 移出房间？', function () {
                        socket.emit('kickPlayer', { roomId: currentRoomId, target: p.name });
                    });
                };
                ops.appendChild(kick);

                const rej = document.createElement('span');
                rej.className = 'op-btn op-danger';
                rej.innerText = '拒绝';
                rej.onclick = function (e) {
                    e.stopPropagation();
                    uiConfirm('拒绝 ' + showName + ' 加入房间？拒绝后 TA 不能再进入本房间', function () {
                        socket.emit('kickPlayer', { roomId: currentRoomId, target: p.name, ban: true });
                    });
                };
                ops.appendChild(rej);

                div.appendChild(ops);
            }
            const hostName = room.players[0] ? room.players[0].name : '';
            if (!p.isReady && !p.isBot && p.name !== currentUser && p.name !== hostName) allReady = false;

            div.onclick = function () {
                if (!p.alive) return;
                if (p.name === currentUser) return;
                if (room.state === 'hunter_shoot') {
                    if (currentUser === hunterName && !hasActed) selectTarget(p.name);
                    return;
                }
                if (!isAlive) return;
                selectTarget(p.name);
            };
            list.appendChild(div);
        });


        if (room.state === 'waiting' || room.state === 'gameover') {
            const fullRoom = room.players.length >= room.maxPlayers;
            setHostText(room.state === 'gameover'
                ? '本局结束，房主可直接再开一局'
                : (fullRoom ? '玩家已到齐' : '等待玩家加入'));
            document.getElementById('ready-btn').style.display = isHost ? 'none' : 'block';
            if (isHost) {
                document.getElementById('host-settings').style.display = 'flex';
                maxPlayersCur = room.maxPlayers;
                paintMaxPlayers();

                const btn = document.getElementById('start-btn');
                btn.style.display = 'block';
                btn.innerText = (allReady && room.players.length === room.maxPlayers)
                    ? '全员就绪，开始游戏'
                    : (room.players.length < room.maxPlayers
                        ? '还差 ' + (room.maxPlayers - room.players.length) + ' 人'
                        : '等待其他玩家准备');
                btn.disabled = !(allReady && room.players.length === room.maxPlayers);
                const nudgeBtn = document.getElementById('nudge-btn');
                const waitingReady = room.players.filter((x, i) => i > 0 && !x.isBot && !x.isReady && x.isConnected && !x.away);
                if (nudgeBtn) {
                    nudgeBtn.style.display = waitingReady.length ? 'block' : 'none';
                    nudgeBtn.innerText = '催促准备[' + waitingReady.length + ']';
                }
            } else {
                document.getElementById('host-settings').style.display = 'none';
                document.getElementById('start-btn').style.display = 'none';
                document.getElementById('nudge-btn').style.display = 'none';
            }
            document.getElementById('action-panel').style.display = 'none';
            hideDock();
        } else {
            document.getElementById('ready-btn').style.display = 'none';
            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('nudge-btn').style.display = 'none';
            document.getElementById('host-settings').style.display = 'none';
        }

        myVoteTarget = (lastRoomData && lastRoomData.votes && lastRoomData.votes[currentUser]) || '';
        if (currentPhase !== 'day_vote') myVoteTarget = '';

        refreshPanel();
        renderPhaseBar();
    }

    socket.on('roomUpdate', function (room) { loadMarks(); applyRoomUpdate(room); paintActionPanel(room); });

    function selectTarget(name) {
        const canChange = currentPhase === 'day_vote'
            || (currentPhase === 'night' && currentNightStep === 'wolf');
        if (hasActed && currentPhase !== 'hunter_shoot' && !canChange) return;
        const list = document.getElementById('player-list').children;
        for (let i = 0; i < list.length; i++) {
            list[i].classList.remove('selected');
            if (list[i].dataset.name === name) {
                list[i].classList.add('selected');
            }
        }
        selectedTarget = name;

        if (currentPhase === 'night') {
            const actNow = hasActed && !(currentNightStep === 'wolf' && myRole === '狼人');
            if (actNow) { setHostText('这一阶段你已经行动过了，等其他人'); return; }
            const label = currentNightStep === 'wolf' ? '击杀'
                : currentNightStep === 'seer' ? '查验'
                : currentNightStep === 'guard' ? '守护'
                : currentNightStep === 'witch' ? '对' : '';
            setHostText('已选中 ' + nickOf(name) + '，点下方按钮确认' + (label && label !== '对' ? ' ' + label : ''));
            return;
        }

        if (currentPhase === 'hunter_shoot' && currentUser === hunterName) {
            if (hasActed) { setHostText('你已经开过枪了'); return; }
            setHostText('已选中 ' + nickOf(name) + '，点下方按钮确认开枪');
            return;
        }

        if (currentPhase === 'day_vote') {
            if (myVoteTarget && myVoteTarget === name) {
                uiConfirm('撤销你投给 ' + nickOf(name) + ' 的票？', function () {
                    socket.emit('action', {
                        roomId: currentRoomId,
                        user: currentUser,
                        phase: 'day_vote',
                        actionType: 'unvote'
                    });
                    myVoteTarget = '';
                    hasActed = false;
                    setHostText('已撤销投票，可以重新选择');
                });
                return;
            }
            uiConfirm('投票放逐 ' + nickOf(name) + '？', function () {
                socket.emit('action', {
                    roomId: currentRoomId,
                    user: currentUser,
                    target: name,
                    phase: 'day_vote',
                    actionType: 'vote'
                });
                hasActed = true;
                myVoteTarget = name;
                const total = lastRoomData ? lastRoomData.players.filter(function (p) { return p.alive; }).length : 0;
                const done = lastRoomData ? Object.keys(lastRoomData.votes || {}).length + 1 : 1;
                setHostText('你已投票给 ' + nickOf(name) + '[' + done + '/' + total + ']；再点同一个人可撤销，点别人可改投');
            }, function () {
                setHostText('已取消投票');
            });
        }
    }

    function setAction(actionType, btn) {
        const isHunterPhase = currentPhase === 'hunter_shoot';
        const isWolfNight = currentPhase === 'night' && currentNightStep === 'wolf';
        if (!isHunterPhase && !isAlive) {
            setHostText('你已经出局，这一局不能再行动了');
            return;
        }
        if (!isHunterPhase && hasActed && !isWolfNight) {
            setHostText('这一阶段你已经行动过了，等其他人');
            return;
        }
        if (isHunterPhase && (currentUser !== hunterName || hasActed)) return;

        document.querySelectorAll('.action-btn').forEach(function (b) { b.classList.remove('active'); });
        if (btn) btn.classList.add('active');

        if (actionType === 'skip') {
            socket.emit('action', {
                roomId: currentRoomId,
                user: currentUser,
                actionType: 'skip',
                phase: currentPhase,
                step: currentNightStep
            });
            hasActed = true;
            document.getElementById('action-panel').style.display = 'none';
            hideDock();
            setHostText(isHunterPhase ? '你选择了不开枪' : '你选择了跳过');
            return;
        }

        if (actionType === 'save') {
            if (!witchPendingKill) return;
            socket.emit('action', {
                roomId: currentRoomId,
                user: currentUser,
                actionType: 'save',
                phase: currentPhase,
                step: currentNightStep
            });
            hasActed = true;
            document.getElementById('action-panel').style.display = 'none';
            hideDock();
            setHostText('你用解药救了 ' + witchPendingKill);
            return;
        }

        if (!selectedTarget) {
            setHostText('请先点击上方玩家列表选择目标');
            return;
        }

        let actionName = '';
        if (actionType === 'kill') actionName = '击杀';
        if (actionType === 'check') actionName = '查验';
        if (actionType === 'poison') actionName = '使用毒药毒';
        if (actionType === 'guard') actionName = '守护';
        if (actionType === 'shoot') actionName = '开枪带走';

        if (actionType === 'guard' && selectedTarget === lastGuardTarget) {
            setHostText('不能连续两晚守护同一个人');
            return;
        }

        const target = selectedTarget;
        const isWolfKill = actionType === 'kill' && currentPhase === 'night' && currentNightStep === 'wolf';
        uiConfirm('确认' + actionName + ' ' + nickOf(target) + '？', function () {
            socket.emit('action', {
                roomId: currentRoomId,
                user: currentUser,
                target: target,
                phase: currentPhase,
                step: currentNightStep,
                actionType: actionType
            });
            hasActed = true;
            if (isWolfKill) {
                setHostText('已发出：击杀 ' + nickOf(target) + '想改刀就点别的玩家再按「击杀」，同一晚可以改');
                return;
            }
            document.getElementById('action-panel').style.display = 'none';
            hideDock();
            if (actionType === 'check') {
                setHostText('正在查验 ' + nickOf(target) + '');
            } else if (actionType === 'shoot') {
                setHostText('你开枪带走了 ' + nickOf(target) + '！');
            } else {
                setHostText('你已提交操作，等待主持人');
            }
        }, function () {
            setHostText('已取消，可重新选目标');
        });
    }

    socket.on('phaseChange', function (data) {
        phaseDeadline = null;
        currentPhase = data.phase;
        currentNightStep = data.step || '';
        hasActed = false;
        hostQueue.length = 0;
        hostShowing = false;
        if (hostTimer) { clearTimeout(hostTimer); hostTimer = null; }
        if (data.msg) pushHostMsg(data.msg, true);
        refreshPanel();
        [200, 600, 1200, 2000, 3000].forEach(function (ms) {
            setTimeout(function () { paintActionPanel(lastRoomData); }, ms);
        });
    });

    socket.on('seerResult', function (data) {
        const resultText = data.result === '狼人' ? '狼人' : '好人';
        pushHostMsg('查验结果：' + data.target + ' 的阵营是 ' + resultText + '', true);
    });

    socket.on('gameEnded', function (msg) {
        currentPhase = 'gameover';
        hasActed = true;
        document.getElementById('action-panel').style.display = 'none';
        setHostText(msg);
        pushHostMsg(msg, true);

        uiConfirm(msg + '要对局日志吗？下载后回到大厅', function () {
            const a = document.createElement('a');
            a.href = '/api/roomlog?room=' + encodeURIComponent(currentRoomId || '');
            a.download = 'wolf-' + (currentRoomId || 'log') + '.log';
            document.body.appendChild(a);
            a.click();
            a.remove();
            uiConfirm('现在离开房间回到大厅吗？点取消可以留在本局', function () { leaveRoomAfterGame(); });
        }, function () {
            uiConfirm('现在离开房间回到大厅吗？点取消可以留在本局', function () { leaveRoomAfterGame(); });
        });
    });

    function clearRoomState() {
        const chat = document.getElementById('chat-box');
        if (chat) chat.innerHTML = '';
        const role = document.getElementById('role-text');
        if (role) role.innerText = '';
        const host = document.getElementById('host-text');
        if (host) host.innerHTML = '';
        const list = document.getElementById('player-list');
        if (list) list.innerHTML = '';
        const ap = document.getElementById('action-panel');
        if (ap) { ap.style.display = 'none'; ap.innerHTML = ''; }
        const badge = document.getElementById('my-role-badge');
        if (badge) badge.style.display = '';
        currentPhase = 'waiting';
        currentNightStep = '';
        witchPendingKill = '';
        hunterName = '';
        lastGuardTarget = '';
        isAlive = true;
        myRole = '';
        hostText = '';
        maxPlayersCur = 6;
        if (skyTimer) { clearTimeout(skyTimer); skyTimer = null; }
        skyIsNight = false;
        document.body.classList.remove('night-mode');
    }

    function leaveRoomAfterGame() {
        if (voiceOn || voiceStream || voicePeers.size) stopVoice(true);
        clearRoomState();
        currentRoomId = '';
        sessionStorage.removeItem('wolf_room');
        backToLobby();
    }
    socket.on('errorMsg', function (msg) {
        if (msg && msg.indexOf('登录状态已失效') >= 0) {
            localStorage.removeItem('wolf_token');
            sessionStorage.removeItem('wolf_user');
            userToken = '';
            currentUser = '';
            uiAlert('登录状态已失效，请重新登录');
            setTimeout(function () { location.href = location.pathname; }, 1200);
            return;
        }
        uiAlert('系统消息：' + msg);
    });

    socket.on('kicked', function (data) {
        uiAlert((data && data.reason) || '你已被房主移出房间', function () {
            sessionStorage.removeItem('wolf_room');
            currentRoomId = '';
            backToLobby();
        });
    });

    async function showRank() {
        document.getElementById('lobby-view').style.display = 'none';
        document.getElementById('rank-view').style.display = 'block';
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        const list = document.getElementById('rank-list');
        list.innerHTML = '';
        if (data.length === 0) {
            list.innerHTML = '<li style="text-align:center; padding:20px; color:var(--text-sub)">暂无对局记录</li>';
        } else {
            data.forEach(function (row, i) {
                const li = document.createElement('li');
                li.className = 'rank-item';
                li.innerHTML = '<div class="rank-user"><img class="rank-avatar" src="'
                    + (row.avatar || AV_DEFAULT) + '" alt=""><span class="rank-name">#' + (i + 1) + ' '
                    + escHtml(row.nickname || row.username) + '</span></div>'
                    + '<span>' + row.win_rate + '% (' + row.wins + '胜/' + row.total_games + '场)</span>';
                li.onclick = function () { openCard(row.username); };
                list.appendChild(li);
            });
        }
    }

    const SND = { on: true, bgm: null, tap: null, lastClick: 0, bgmFailed: false };
    const BGM_FILE = '/audio/bgm.mp3';
    const SFX_FILE = '/audio/click.mp3';

    function sfxClick() {
        if (!SND.on) return;
        const now = Date.now();
        if (now - SND.lastClick < 55) return;
        SND.lastClick = now;
        try {
            if (!SND.tap) {
                SND.tap = new Audio(SFX_FILE);
                SND.tap.preload = 'auto';
                SND.tap.volume = 0.42;
            }
            SND.tap.currentTime = 0;
            const pr = SND.tap.play();
            if (pr && pr.catch) pr.catch(function () { });
        } catch (e) { }
    }

    function bgmStart() {
        if (!SND.on || SND.bgmFailed) return;
        try {
            if (!SND.bgm) {
                SND.bgm = new Audio(BGM_FILE);
                SND.bgm.loop = true;
                SND.bgm.preload = 'auto';
                SND.bgm.volume = 0.58;
                SND.bgm.addEventListener('error', function () {
                    SND.bgmFailed = true;
                    const b = document.getElementById('sound-btn');
                    if (b) b.title = '背景音乐文件读取失败：检查 audio/bgm.mp3';
                });
            }
            if (!SND.bgm.paused) {
                SND.bgmBlocked = false;
                const b = document.getElementById('sound-btn');
                if (b && SND.on) b.title = '关闭声音';
            }
            if (SND.bgm.paused) {
                const pr = SND.bgm.play();
                if (pr && pr.catch) pr.catch(function () {
                    SND.bgmBlocked = true;
                    const b = document.getElementById('sound-btn');
                    if (b) b.title = '点一下页面或按钮即可播放背景音乐';
                });
            }
        } catch (e) { }
    }

    function bgmStop() {
        try {
            if (SND.bgm && !SND.bgm.paused) SND.bgm.pause();
        } catch (e) { }
    }

    const SND_ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 9v6h3.6L12 19V5L7.6 9H4z"/>'
        + '<path d="M15.6 9.2a4 4 0 0 1 0 5.6"/>'
        + '<path d="M18.3 6.8a7.4 7.4 0 0 1 0 10.4"/>'
        + '</svg>';
    const SND_ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 9v6h3.6L12 19V5L7.6 9H4z"/>'
        + '<path d="M16 10l4 4"/>'
        + '<path d="M20 10l-4 4"/>'
        + '</svg>';

    function applySoundUI() {
        const b = document.getElementById('sound-btn');
        if (!b) return;
        b.innerHTML = SND.on ? SND_ICON_ON : SND_ICON_OFF;
        b.className = 'sound-btn' + (SND.on ? ' on' : '');
        b.setAttribute('aria-label', SND.on ? '关闭声音' : '打开声音');
    }

    function toggleSound() {
        SND.on = !SND.on;
        try { localStorage.setItem('wolf_sound', SND.on ? '1' : '0'); } catch (e) { }
        applySoundUI();
        if (SND.on) {
            SND.bgmFailed = false;
            bgmStart();
            sfxClick();
        } else {
            bgmStop();
        }
    }

    function initSound() {
        try { SND.on = localStorage.getItem('wolf_sound') !== '0'; } catch (e) { SND.on = true; }
        applySoundUI();
        bgmStart();
        const unlock = function (e) {
            try {
                if (!SND.on) return;
                bgmStart();
                const target = e && e.target;
                if (target && target.closest && target.closest('button, .btn, .action-btn, a, input, select, textarea, [role="button"]')) {
                    sfxClick();
                }
            } catch (err) { console.warn('声音初始化失败', err); }
        };
        if (window.PointerEvent) {
            document.addEventListener('pointerdown', unlock, true);
        } else {
            document.addEventListener('touchstart', unlock, { capture: true, passive: true });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') unlock(e);
        }, true);
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) bgmStop();
            else if (SND.on) bgmStart();
        });
    }

    window.onload = async function () {
        initSound();
        setInterval(renderPhaseBar, 500);
        await autoLoginFromUrl();
        restoreAdminEntry();

        if (currentUser && !userToken) {
            sessionStorage.removeItem('wolf_user');
            currentUser = '';
            currentNickname = '';
        }

        const joinId = new URLSearchParams(location.search).get('join');
        if (joinId) {
            sessionStorage.setItem('wolf_room', joinId);
            currentRoomId = joinId;
        }

        if (currentUser) {
            enterLobby();
            if (currentRoomId && socket.connected) {
                socket.emit('joinRoom', { roomId: currentRoomId, user: currentUser, nickname: currentNickname || currentUser });
            }
        }
    };
