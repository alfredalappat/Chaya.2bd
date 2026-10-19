(() => {
  const $ = id => document.getElementById(id);
  const homeView = $('homeView'), chatView = $('chatView'), messageArea = $('messageArea');
  const startButton = $('startButton'), nextButton = $('nextButton'), endButton = $('endButton');
  const messageInput = $('messageInput'), sendButton = $('sendButton'), messageForm = $('messageForm');
  const chatStatus = $('chatStatus'), partnerTitle = $('partnerTitle'), partnerSubtitle = $('partnerSubtitle');
  const partnerAvatar = $('partnerAvatar'), typingRow = $('typingRow'), typingText = $('typingText');
  const systemNote = $('systemNote'), actionHint = $('actionHint'), onlineCount = $('onlineCount');
  const toast = $('toast');
  let socket, reconnectTimer, toastTimer, chatActive = false, partnerKind = null, currentRoom = null, manuallyClosed = false, typingTimer;
  let localOnline = 0;

  function showToast(text) {
    toast.textContent = text; toast.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }
  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${location.host}/ws`);
    socket.addEventListener('open', () => { onlineCount.textContent = `${localOnline || 1} online`; if (chatActive && !manuallyClosed) showToast('Reconnected. Tap Next to find a new chat.'); });
    socket.addEventListener('message', event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      handleServerMessage(data);
    });
    socket.addEventListener('close', () => {
      onlineCount.textContent = 'Reconnecting…'; setConnected(false);
      if (!manuallyClosed) reconnectTimer = setTimeout(connect, 1800);
    });
    socket.addEventListener('error', () => {});
  }
  function send(payload) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    else showToast('Connecting to chat server. Please try again in a moment.');
  }
  function handleServerMessage(data) {
    if (data.type === 'welcome') { localOnline = data.online || 1; onlineCount.textContent = `${localOnline} online`; }
    if (data.type === 'presence') { localOnline = data.online || 0; onlineCount.textContent = `${localOnline} online`; }
    if (data.type === 'waiting') {
      chatStatus.textContent = 'Finding someone…'; partnerTitle.textContent = 'Looking for a stranger'; partnerSubtitle.textContent = 'We are checking for someone available to chat.';
      partnerAvatar.textContent = '…'; startButton.disabled = true; startButton.innerHTML = '<span>Finding someone…</span><span class="loading-glyph">···</span>';
      actionHint.textContent = 'Looking for a real person first. This may take a few seconds.'; setConnected(false); clearMessages();
    }
    if (data.type === 'matched') {
      currentRoom = data.roomId; partnerKind = data.partnerType; chatActive = true;
      chatStatus.textContent = 'Connected';
      partnerTitle.textContent = 'Your chat partner';
      partnerSubtitle.textContent = 'You are connected. Say hello and see where it goes.';
      partnerAvatar.textContent = 'C';
      setConnected(true); startButton.classList.add('hidden'); nextButton.classList.remove('hidden'); endButton.classList.remove('hidden');
      actionHint.textContent = 'You can leave or find another conversation at any time.';
      clearMessages(); showSystemNote('You are connected.');
      if (partnerKind === 'automated') showToast('This conversation uses an automated chat partner.');
      messageInput.focus();
    }
    if (data.type === 'message') addMessage(data.from, data.text, data.time);
    if (data.type === 'typing') {
      typingText.textContent = 'The other person is typing';
      typingRow.classList.toggle('hidden', !data.active); scrollMessages();
    }
    if (data.type === 'partner_left') {
      chatActive = false; setConnected(false); chatStatus.textContent = 'Conversation ended';
      showSystemNote(data.message || 'The other person left the chat.');
      startButton.classList.remove('hidden'); nextButton.classList.add('hidden'); startButton.disabled = false; startButton.innerHTML = '<span>Find a stranger</span><span aria-hidden="true">↗</span>';
      actionHint.textContent = 'Tap Next stranger to start another conversation.'; showToast('Chat ended. You can find someone new.');
    }
    if (data.type === 'bot_ending') showSystemNote(data.message);
    if (data.type === 'ended') {
      chatActive = false; currentRoom = null; setConnected(false); typingRow.classList.add('hidden');
      startButton.classList.remove('hidden'); nextButton.classList.add('hidden'); startButton.disabled = false; startButton.innerHTML = '<span>Find a stranger</span><span aria-hidden="true">↗</span>';
      chatStatus.textContent = data.reason === 'next' ? 'Finding someone…' : 'Chat ended';
    }
    if (data.type === 'error') showToast(data.message || 'Something went wrong.');
  }
  function setConnected(connected) { messageInput.disabled = !connected; sendButton.disabled = !connected; }
  function clearMessages() {
    messageArea.innerHTML = ''; typingRow.classList.add('hidden'); systemNote.classList.add('hidden');
  }
  function showSystemNote(text) { systemNote.textContent = text; systemNote.classList.remove('hidden'); }
  function addMessage(from, text, time) {
    const empty = messageArea.querySelector('.empty-chat'); if (empty) empty.remove();
    const mine = from === 'you';
    const wrapper = document.createElement('div'); wrapper.className = `message ${mine ? 'mine' : 'theirs'}`;
    if (!mine) {
      const label = document.createElement('div'); label.className = 'message-label';
      label.textContent = from === 'partner' ? 'Chat partner' : 'Stranger'; wrapper.appendChild(label);
    }
    const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = text;
    const meta = document.createElement('div'); meta.className = 'message-meta';
    meta.textContent = new Date(time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrapper.append(bubble, meta); messageArea.appendChild(wrapper); scrollMessages();
  }
  function scrollMessages() { messageArea.scrollTop = messageArea.scrollHeight; }
  function openChat() { homeView.classList.add('hidden'); chatView.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); connect(); }
  function startChat() { openChat(); chatActive = false; manuallyClosed = false; send({ type: 'start' }); }
  function nextChat() { manuallyClosed = false; send({ type: 'next' }); clearMessages(); chatStatus.textContent = 'Finding someone…'; startButton.classList.remove('hidden'); startButton.disabled = true; startButton.innerHTML = '<span>Finding someone…</span><span>···</span>'; nextButton.classList.add('hidden'); }

  $('textModeButton').addEventListener('click', startChat);
  $('videoModeButton').addEventListener('click', () => showToast('Video chat is coming soon. Text chat is available now.'));
  startButton.addEventListener('click', startChat);
  nextButton.addEventListener('click', nextChat);
  endButton.addEventListener('click', () => { send({ type: 'end' }); chatActive = false; clearMessages(); showSystemNote('You ended the conversation. Start a new chat whenever you like.'); });
  $('backButton').addEventListener('click', () => {
    if (chatActive) send({ type: 'end' });
    chatActive = false; homeView.classList.remove('hidden'); chatView.classList.add('hidden');
  });
  messageForm.addEventListener('submit', event => {
    event.preventDefault(); const text = messageInput.value.trim(); if (!text || !chatActive) return;
    send({ type: 'chat', text }); messageInput.value = ''; send({ type: 'typing', active: false });
  });
  messageInput.addEventListener('input', () => {
    if (!chatActive || partnerKind !== 'person') return;
    send({ type: 'typing', active: true }); clearTimeout(typingTimer); typingTimer = setTimeout(() => send({ type: 'typing', active: false }), 1000);
  });
  const aboutDialog = $('aboutDialog');
  const openAbout = () => typeof aboutDialog.showModal === 'function' ? aboutDialog.showModal() : showToast('Chaya.2bd is a casual stranger text chat. Be respectful and protect your privacy.');
  $('aboutButton').addEventListener('click', openAbout); $('footerAbout').addEventListener('click', openAbout);
  $('closeDialog').addEventListener('click', () => aboutDialog.close()); $('dialogDone').addEventListener('click', () => aboutDialog.close());
  window.addEventListener('online', connect);
  window.addEventListener('beforeunload', () => { manuallyClosed = true; clearTimeout(reconnectTimer); if (socket) socket.close(); });
  connect();
})();
