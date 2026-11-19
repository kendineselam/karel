// ==UserScript==
// @name         Karel Santral Çağrı Bildirimi (Popup + Sistem + Ses + Çağrı Geçmişi)
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Çağrı geldiğinde ekranın üst-ortasında büyük bir popup, ses ve sistem bildirimi gösterir. Sağ üstte çağrı ikonu ile geçmişi gösterir. Sol üstte "Dahililere Git" butonu bulunur (dahili sayfasında gizlenir). Sayfa yenilense bile kayıtlar korunur. Kapat ve Temizle butonları mevcut. Görüşüyor ise ses çalmaz. Çoklu çağrı desteği. Kesinlikle kasmaz!
// @author       ChatGPT
// @match        https://santral.karel.cloud/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kendineselam/karel/main/karel-call-notifier.user.js
// @downloadURL  https://raw.githubusercontent.com/kendineselam/karel/main/karel-call-notifier.user.js
// ==/UserScript==

(function () {
    'use strict';

    // State değişkenleri - hafif ve hızlı
    let popups = [];
    let activeCalls = new Map();
    let audio = null;
    let audioPlaying = false;
    let historyPopup = null;
    let callIcon = null;
    let observerTimeout = null;
    let detectedCalls = new Set();
    let lastNotificationTime = 0;
    let isProcessing = false;

    // Bildirim izni
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    // Çağrı geçmişi fonksiyonları
    function getCallHistory() {
        try {
            const history = localStorage.getItem('karelCallHistory');
            return history ? JSON.parse(history) : [];
        } catch (e) {
            return [];
        }
    }

    function addCallToHistory(phoneNumber) {
        if (!phoneNumber) return;
        const history = getCallHistory();

        const now = Date.now();
        if (history.length > 0) {
            const lastEntry = history[history.length - 1];
            if (lastEntry.number === phoneNumber && (now - new Date(lastEntry.datetime).getTime()) < 10000) {
                return;
            }
        }

        const date = new Date();
        history.push({
            number: phoneNumber,
            datetime: date.toLocaleString(),
            timestamp: date.getTime()
        });

        if (history.length > 100) {
            history.splice(0, history.length - 100);
        }

        localStorage.setItem('karelCallHistory', JSON.stringify(history));
    }

    function clearCallHistory() {
        localStorage.removeItem('karelCallHistory');
        if (historyPopup) {
            const list = historyPopup.querySelector('.history-list');
            if (list) list.innerHTML = '<i>Çağrı geçmişi boş.</i>';
        }
    }

    // Geçmiş popup
    function createHistoryPopup() {
        if (historyPopup) return;

        historyPopup = document.createElement('div');
        Object.assign(historyPopup.style, {
            position: 'fixed',
            top: '60px',
            right: '10px',
            width: '320px',
            maxHeight: '400px',
            overflowY: 'auto',
            backgroundColor: '#fff',
            border: '2px solid #f44336',
            borderRadius: '12px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
            padding: '12px 16px',
            zIndex: 99999,
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            color: '#333',
            display: 'none'
        });

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '10px';

        const title = document.createElement('strong');
        title.textContent = 'Çağrı Geçmişi';
        header.appendChild(title);

        const btnContainer = document.createElement('div');

        const btnClose = document.createElement('button');
        btnClose.textContent = 'Kapat';
        btnClose.style.marginRight = '8px';
        btnClose.style.cursor = 'pointer';
        btnClose.onclick = (e) => {
            e.stopPropagation();
            if (historyPopup) historyPopup.style.display = 'none';
        };
        btnContainer.appendChild(btnClose);

        const btnClear = document.createElement('button');
        btnClear.textContent = 'Temizle';
        btnClear.style.cursor = 'pointer';
        btnClear.onclick = (e) => {
            e.stopPropagation();
            if (confirm('Çağrı geçmişini temizlemek istediğinizden emin misiniz?')) {
                clearCallHistory();
            }
        };
        btnContainer.appendChild(btnClear);

        header.appendChild(btnContainer);
        historyPopup.appendChild(header);

        const list = document.createElement('div');
        list.className = 'history-list';
        historyPopup.appendChild(list);

        document.body.appendChild(historyPopup);
        refreshHistoryList();
    }

    function refreshHistoryList() {
        if (!historyPopup) return;
        const list = historyPopup.querySelector('.history-list');
        const history = getCallHistory();
        if (history.length === 0) {
            list.innerHTML = '<i>Çağrı geçmişi boş.</i>';
            return;
        }
        list.innerHTML = '';
        const showHistory = history.slice(-20).reverse();
        showHistory.forEach(item => {
            const entry = document.createElement('div');
            entry.style.borderBottom = '1px solid #eee';
            entry.style.padding = '6px 0';
            entry.innerHTML = `<strong>${item.number}</strong><br><small>${item.datetime}</small>`;
            list.appendChild(entry);
        });
    }

    // Çağrı ikonu
    function createCallIcon() {
        if (callIcon) return;

        callIcon = document.createElement('div');
        callIcon.title = 'Çağrı Geçmişini Göster';
        Object.assign(callIcon.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            width: '48px',
            height: '48px',
            backgroundColor: '#f44336',
            borderRadius: '50%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'pointer',
            zIndex: 99998,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            userSelect: 'none',
            transition: 'transform 0.2s'
        });

        callIcon.onmouseover = () => { callIcon.style.transform = 'scale(1.1)'; };
        callIcon.onmouseout = () => { callIcon.style.transform = 'scale(1)'; };

        callIcon.innerHTML =
            `<svg xmlns="http://www.w3.org/2000/svg" fill="#fff" viewBox="0 0 24 24" width="28" height="28">
                <path d="M6.62 10.79a15.091 15.091 0 006.59 6.59l2.2-2.2a1 1 0 011.11-.21c1.21.48 2.53.74 3.88.74a1 1 0 011 1v3.5a1 1 0 01-1 1C10.07 21.9 2.1 13.93 2.1 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.35.26 2.67.74 3.88a1 1 0 01-.21 1.11l-2.2 2.2z"/>
            </svg>`;

        callIcon.onclick = (e) => {
            e.stopPropagation();
            createHistoryPopup();
            if (historyPopup.style.display === 'block') {
                historyPopup.style.display = 'none';
            } else {
                refreshHistoryList();
                historyPopup.style.display = 'block';
            }
        };

        document.body.appendChild(callIcon);
    }

    // Dahililere Git butonu (sol üst, sabit - dahili sayfasında gizlenir)
    function isDahiliPage() {
        return location.pathname.indexOf('/user/internalstatus') !== -1;
    }

    function updateDahiliButtonVisibility() {
        const btn = document.getElementById('karel-dahili-btn');
        if (!btn) return;
        btn.style.display = isDahiliPage() ? 'none' : 'block';
    }

    function createDahiliButton() {
        if (document.getElementById('karel-dahili-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'karel-dahili-btn';
        btn.textContent = '📋 Dahililere Git';
        Object.assign(btn.style, {
            position: 'fixed',
            top: '10px',
            left: '10px',
            padding: '10px 18px',
            backgroundColor: '#f44336',
            color: '#fff',
            border: '2px solid #fff',
            borderRadius: '10px',
            fontSize: '15px',
            fontWeight: 'bold',
            fontFamily: 'Arial, sans-serif',
            cursor: 'pointer',
            zIndex: 99998,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        });

        btn.onclick = (e) => {
            e.stopPropagation();
            window.location.href = 'https://santral.karel.cloud/user/internalstatus';
        };

        document.body.appendChild(btn);
        updateDahiliButtonVisibility();
    }

    // Popup göster - optimize edilmiş
    function showPopup(phoneNumber, isTalking) {
        if (!phoneNumber || isProcessing) return;

        // Aynı çağrıyı tekrar gösterme
        const callKey = `${phoneNumber}_${Date.now()}`;
        if (activeCalls.has(callKey)) return;

        isProcessing = true;

        // Popup oluştur
        const popup = document.createElement('div');
        const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        popup.setAttribute('data-call-id', callId);

        activeCalls.set(callId, {
            phoneNumber: phoneNumber,
            isTalking: isTalking,
            timestamp: Date.now()
        });

        const contentDiv = document.createElement('div');
        contentDiv.style.display = 'flex';
        contentDiv.style.justifyContent = 'space-between';
        contentDiv.style.alignItems = 'center';
        contentDiv.style.width = '100%';
        contentDiv.style.gap = '15px';

        const textSpan = document.createElement('span');
        textSpan.textContent = `📞 Arayan Numara: ${phoneNumber}`;
        textSpan.style.flex = '1';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.padding = '5px 12px';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '5px';
        closeBtn.style.backgroundColor = '#f44336';
        closeBtn.style.color = 'white';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '18px';
        closeBtn.style.fontWeight = 'bold';
        closeBtn.style.flexShrink = '0';

        closeBtn.onclick = (e) => {
            e.stopPropagation();
            removePopup(callId);
        };

        contentDiv.appendChild(textSpan);
        contentDiv.appendChild(closeBtn);
        popup.appendChild(contentDiv);

        // Popup konumlandırma - yukarıdan başla
        const popupCount = popups.length;
        const baseTop = 3;
        const spacing = 11;
        const topOffset = Math.min(baseTop + (popupCount * spacing), 70);

        Object.assign(popup.style, {
            position: 'fixed',
            top: `${topOffset}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#ffeb3b',
            border: '4px solid #f44336',
            color: '#000',
            padding: '15px 25px',
            borderRadius: '12px',
            fontSize: '20px',
            fontWeight: 'bold',
            zIndex: 99999,
            textAlign: 'center',
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            maxWidth: '80%',
            minWidth: '250px',
            wordBreak: 'break-all',
            transition: 'all 0.25s ease',
            opacity: '0',
            pointerEvents: 'auto'
        });

        popups.push(popup);
        document.body.appendChild(popup);

        // Fade in
        requestAnimationFrame(() => {
            popup.style.opacity = '1';
        });

        // Ses - sadece ilk çağrıda
        if (!isTalking && !audioPlaying) {
            playSound();
        }

        // Geçmişe ekle
        addCallToHistory(phoneNumber);

        // Bildirim
        const now = Date.now();
        if (Notification.permission === "granted" && (now - lastNotificationTime) > 5000) {
            lastNotificationTime = now;
            try {
                const notification = new Notification("Yeni Çağrı", {
                    body: `Arayan Numara: ${phoneNumber}`,
                    icon: "https://cdn-icons-png.flaticon.com/512/159/159832.png"
                });

                notification.onclick = function () {
                    window.focus();
                    this.close();
                };
            } catch (e) {}
        }

        // 60 saniye sonra otomatik kapat
        setTimeout(() => {
            removePopup(callId);
        }, 60000);

        isProcessing = false;
    }

    // Popup kaldır
    function removePopup(callId) {
        if (!activeCalls.has(callId)) return;

        const index = popups.findIndex(p => p.getAttribute('data-call-id') === callId);
        if (index !== -1) {
            const popup = popups[index];
            popup.style.opacity = '0';
            setTimeout(() => {
                popup.remove();
                popups.splice(index, 1);
                // Popup'ları yeniden düzenle
                const baseTop = 3;
                const spacing = 11;
                popups.forEach((p, i) => {
                    const topOffset = Math.min(baseTop + (i * spacing), 70);
                    p.style.top = `${topOffset}%`;
                });
            }, 250);
        }

        activeCalls.delete(callId);

        if (popups.length === 0) {
            stopSound();
        }
    }

    // Ses fonksiyonları
    function playSound() {
        if (audioPlaying) return;

        try {
            if (audio) {
                audio.pause();
                audio.currentTime = 0;
                audio = null;
            }

            audio = new Audio('https://santral.karel.cloud/sound/6.mp3');
            audio.loop = true;
            audio.volume = 0.5;
            audioPlaying = true;

            audio.play().catch(() => {
                audioPlaying = false;
            });
        } catch (e) {
            audioPlaying = false;
        }
    }

    function stopSound() {
        if (audio) {
            try {
                audio.pause();
                audio.currentTime = 0;
                audio = null;
            } catch (e) {}
        }
        audioPlaying = false;
    }

    // Tüm popup'ları temizle
    function clearAllPopups() {
        popups.forEach(popup => {
            popup.style.opacity = '0';
            setTimeout(() => popup.remove(), 250);
        });
        popups = [];
        activeCalls.clear();
        detectedCalls.clear();
        stopSound();
    }

    // DOM Observer - ÇOK HAFİF VE HIZLI
    const observer = new MutationObserver(() => {
        if (observerTimeout) {
            clearTimeout(observerTimeout);
        }

        observerTimeout = setTimeout(() => {
            try {
                const ringingElements = document.querySelectorAll('.c-ringing');
                const currentCalls = new Set();

                if (ringingElements.length > 0) {
                    ringingElements.forEach((ringingElement, index) => {
                        const numberDiv = ringingElement.querySelector('div[style*="font-size: 15px"]');
                        if (numberDiv) {
                            const phoneNumber = numberDiv.textContent.trim();
                            const callKey = `${phoneNumber}_${index}`;
                            currentCalls.add(callKey);

                            if (!detectedCalls.has(callKey)) {
                                const answerDiv = document.querySelector('.c-answer');
                                let isTalking = false;
                                if (answerDiv) {
                                    isTalking = answerDiv.textContent.includes('Görüşüyor');
                                }

                                showPopup(phoneNumber, isTalking);
                                detectedCalls.add(callKey);
                            }
                        }
                    });

                    // Eski çağrıları temizle
                    detectedCalls.forEach(callKey => {
                        if (!currentCalls.has(callKey)) {
                            // İlgili popup'ı bul ve kaldır
                            const phoneNumber = callKey.split('_')[0];
                            const popupToRemove = popups.find(p => {
                                return p.textContent.includes(phoneNumber);
                            });

                            if (popupToRemove) {
                                const callId = popupToRemove.getAttribute('data-call-id');
                                if (callId) {
                                    removePopup(callId);
                                }
                            }
                            detectedCalls.delete(callKey);
                        }
                    });

                } else {
                    if (popups.length > 0) {
                        clearAllPopups();
                    }
                }
            } catch (e) {
                // Sessiz hata yönetimi
            }
            observerTimeout = null;
        }, 80); // 80ms ile çok hızlı tepki
    });

    // Observer'ı başlat
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
    });

    // Çağrı ikonu
    createCallIcon();

    // Dahililere Git butonu (sayfa değişirse görünürlüğü günceller)
    createDahiliButton();
    setInterval(updateDahiliButtonVisibility, 500);

    // Sayfa kapanırken temizlik
    window.addEventListener('beforeunload', function() {
        clearAllPopups();
        if (observer) {
            observer.disconnect();
        }
        if (observerTimeout) {
            clearTimeout(observerTimeout);
        }
        if (audio) {
            audio.pause();
            audio = null;
        }
    });

})();