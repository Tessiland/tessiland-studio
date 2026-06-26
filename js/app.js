// Service Worker — disabilitato per primo deploy, da attivare dopo verifica produzione
// if ('serviceWorker' in navigator && location.protocol === 'https:') {
//     navigator.serviceWorker.register('./sw.js').catch(() => {});
// }

document.addEventListener('DOMContentLoaded', () => {

    // ============================================================
    // URL BACKEND (Cloud Functions — non modificare)
    // ============================================================
    const URL_CACHE_TUTORIALS = 'https://storage.googleapis.com/mtt-management-tool.firebasestorage.app/cache/tutorials.json';
    const URL_FILATI  = 'https://getfilati-blvnz6q2ua-uc.a.run.app';
    const URL_FATTORI = 'https://us-central1-mtt-management-tool.cloudfunctions.net/getFattoriPunto';
    const URL_CALCOLO = 'https://stimaconsumoavanzata-blvnz6q2ua-uc.a.run.app';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const safeUrl = u => { try { const url = new URL(u, location.href); return ['http:','https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };

    // ============================================================
    // PREFERITI (localStorage)
    // ============================================================
    function getPreferiti() {
        try { return JSON.parse(localStorage.getItem('ts-preferiti') || '[]'); } catch { return []; }
    }
    function togglePreferito(id) {
        const lista = getPreferiti();
        const idx = lista.indexOf(id);
        if (idx >= 0) lista.splice(idx, 1); else lista.push(id);
        localStorage.setItem('ts-preferiti', JSON.stringify(lista));
        aggiornaContatorPreferiti();
        return idx < 0;
    }
    function isPreferito(id) { return getPreferiti().includes(id); }
    function aggiornaContatorPreferiti() {
        const n = getPreferiti().length;
        const badge = document.getElementById('preferiti-count');
        if (badge) {
            badge.textContent = n;
            badge.classList.toggle('hidden', n === 0);
        }
    }

    // Banner iOS
    function mostraBannerIOS() {
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        const dismissed = localStorage.getItem('ts-ios-banner-dismissed');
        if (isIos && !isStandalone && !dismissed) {
            document.getElementById('ios-install-banner')?.classList.remove('hidden');
        }
    }
    document.getElementById('ios-banner-close')?.addEventListener('click', () => {
        document.getElementById('ios-install-banner')?.classList.add('hidden');
        localStorage.setItem('ts-ios-banner-dismissed', '1');
    });

    // ============================================================
    // STATO
    // ============================================================
    const stato = {
        dati: {
            tuttiTutorials: [],
            tuttiFilati: [],
            tuttiFilatiMap: new Map(),   // id → filato
            fattoriPunto: {}
        },
        filtriCatalogo: {
            termineRicerca: '',
            autrice: 'tutte',
            filatoId: ''             // id filato collegato ('' = tutti)
        },
        cacheRisultatoCalcolo: {}
    };

    // ============================================================
    // RIFERIMENTI DOM — catalogo
    // ============================================================
    const tabButtons   = document.querySelectorAll('.tool-nav-card');
    const tabContents  = document.querySelectorAll('.tab-content');

    const contenitoreCatalogo = document.getElementById('catalogo-container');
    const searchInput         = document.getElementById('search-input');
    const dropdownAutrice     = document.getElementById('dropdown-autrice');
    const dropdownFilato      = document.getElementById('dropdown-filato');

    // ============================================================
    // DROPDOWN CUSTOM — logica generica
    // ============================================================
    function initDropdown(container, onChange) {
        const trigger = container.querySelector('.cd-trigger');
        const label   = container.querySelector('.cd-trigger-label');
        const clear   = container.querySelector('.cd-trigger-clear');
        const panel   = container.querySelector('.cd-panel');
        const search  = container.querySelector('.cd-search');
        const options = container.querySelector('.cd-options');

        function open() {
            panel.classList.add('open');
            trigger.classList.add('open');
            search.value = '';
            filterOptions('');
            search.focus();
        }
        function close() {
            panel.classList.remove('open');
            trigger.classList.remove('open');
        }
        function setValue(value, text, silent) {
            container.dataset.value = value;
            label.textContent = text || container.dataset.placeholder;
            label.classList.toggle('placeholder', !value);
            trigger.classList.toggle('has-value', !!value);
            close();
            if (!silent) onChange(value);
        }
        function filterOptions(term) {
            const t = term.toLowerCase();
            options.querySelectorAll('.cd-option').forEach(btn => {
                const match = btn.textContent.toLowerCase().includes(t);
                btn.style.display = match ? '' : 'none';
            });
            const noEmpty = container.querySelector('.cd-empty');
            const visibili = options.querySelectorAll('.cd-option:not([style*="display: none"])');
            if (visibili.length === 0) {
                if (!noEmpty) {
                    const p = document.createElement('div');
                    p.className = 'cd-empty';
                    p.textContent = 'Nessun risultato';
                    options.appendChild(p);
                }
            } else if (noEmpty) { noEmpty.remove(); }
        }

        trigger.addEventListener('click', e => {
            if (e.target.closest('.cd-trigger-clear')) return;
            panel.classList.contains('open') ? close() : open();
        });
        clear?.addEventListener('click', e => {
            e.stopPropagation();
            setValue('', '');
        });
        search.addEventListener('input', () => filterOptions(search.value));
        options.addEventListener('click', e => {
            const btn = e.target.closest('.cd-option');
            if (!btn) return;
            options.querySelectorAll('.cd-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            setValue(btn.dataset.value, btn.textContent);
        });
        document.addEventListener('click', e => {
            if (!container.contains(e.target)) close();
        });

        container._dropdown = { setValue, close, setOptions(items) {
            options.innerHTML = items.map(it =>
                `<button type="button" class="cd-option" data-value="${esc(it.value)}" role="option">${esc(it.label)}</button>`
            ).join('');
        }};
    }

    initDropdown(dropdownAutrice, val => {
        stato.filtriCatalogo.autrice = val || 'tutte';
        renderAppCatalogo();
    });
    initDropdown(dropdownFilato, val => {
        stato.filtriCatalogo.filatoId = val;
        renderAppCatalogo();
    });

    // ============================================================
    // WRAP SELECT → dropdown custom (per i select del tool consumo)
    // ============================================================
    function wrapSelect(selectEl) {
        if (!selectEl || selectEl.style.display === 'none') return;
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-dropdown';
        const firstOpt = selectEl.options[0];
        const hasEmpty = firstOpt && firstOpt.value === '';
        const placeholder = hasEmpty ? firstOpt.text : 'Seleziona...';
        wrapper.dataset.placeholder = placeholder;
        wrapper.dataset.value = selectEl.value;
        wrapper.innerHTML = `
            <button type="button" class="cd-trigger${selectEl.value && hasEmpty ? ' has-value' : ''}" aria-haspopup="listbox">
                <span class="cd-trigger-label ${selectEl.value ? '' : 'placeholder'}">${selectEl.value ? selectEl.options[selectEl.selectedIndex].text : placeholder}</span>
                ${hasEmpty ? '<span class="cd-trigger-clear" aria-label="Reset">✕</span>' : ''}
                <span class="cd-trigger-arrow"></span>
            </button>
            <div class="cd-panel" role="listbox">
                <input type="text" class="cd-search" placeholder="Cerca...">
                <div class="cd-options"></div>
            </div>`;
        selectEl.parentNode.insertBefore(wrapper, selectEl);
        selectEl.style.display = 'none';

        function syncFromSelect() {
            const opts = wrapper.querySelector('.cd-options');
            const items = [...selectEl.options]
                .filter(o => o.value !== '')
                .map(o => `<button type="button" class="cd-option${o.value === selectEl.value ? ' selected' : ''}" data-value="${esc(o.value)}" role="option">${esc(o.text)}</button>`)
                .join('');
            opts.innerHTML = items;
            const label = wrapper.querySelector('.cd-trigger-label');
            const trigger = wrapper.querySelector('.cd-trigger');
            if (selectEl.value && selectEl.selectedIndex >= 0) {
                label.textContent = selectEl.options[selectEl.selectedIndex].text;
                label.classList.remove('placeholder');
                trigger.classList.add('has-value');
            } else {
                label.textContent = placeholder;
                label.classList.add('placeholder');
                trigger.classList.remove('has-value');
            }
            wrapper.dataset.value = selectEl.value;
        }

        initDropdown(wrapper, val => {
            selectEl.value = val;
            selectEl.dispatchEvent(new Event('change'));
        });
        syncFromSelect();

        const observer = new MutationObserver(() => syncFromSelect());
        observer.observe(selectEl, { childList: true, subtree: true, attributes: true });
        selectEl.addEventListener('change', () => syncFromSelect());

        const origValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(selectEl, 'value', {
            get() { return origValueDesc.get.call(selectEl); },
            set(v) { origValueDesc.set.call(selectEl, v); syncFromSelect(); }
        });

        return wrapper;
    }

    // Tool Calcolo Filato
    const tipoProgettoSelect                 = document.getElementById('tipo-progetto');
    const campiMisureStandardContainer       = document.getElementById('campi-misure-standard');
    const campiMisurePersonalizzateContainer = document.getElementById('campi-misure-personalizzate');
    const tipoProgettoPersonalizzatoSelect   = document.getElementById('tipo-progetto-personalizzato');
    const campiMisurePersonalizzateDinamici  = document.getElementById('campi-misure-personalizzate-dinamici');
    const filatoSelect      = document.getElementById('filato-selezionato');
    const lavorazioneSelect = document.getElementById('tipo-lavorazione');
    const puntoSelect       = document.getElementById('tipo-punto');
    const tensioneSlider    = document.getElementById('tensione-slider');
    const campioneCheck     = document.getElementById('ho-campione-check');
    const datiCampioneDiv   = document.getElementById('dati-campione');
    const calcolaBtn        = document.getElementById('calcola-consumo-btn');
    const risultatoDiv      = document.getElementById('risultato-consumo');
    const blockCatalogo     = document.getElementById('block-catalogo');
    const blockStandard     = document.getElementById('block-standard');
    const containerFilatoCatalogo = document.getElementById('container-filato-catalogo');
    const containerFilatoStandard = document.getElementById('container-filato-standard');

    // Wrap select → dropdown custom (tool consumo)
    wrapSelect(tipoProgettoSelect);
    wrapSelect(tipoProgettoPersonalizzatoSelect);
    wrapSelect(lavorazioneSelect);
    wrapSelect(puntoSelect);
    wrapSelect(document.getElementById('standard-selezionato'));

    // Menu header ⋮
    const headerMenuBtn = document.getElementById('header-menu-btn');
    const headerMenuPanel = document.getElementById('header-menu-panel');
    headerMenuBtn?.addEventListener('click', () => headerMenuPanel.classList.toggle('open'));
    document.addEventListener('click', e => {
        if (!headerMenuBtn?.contains(e.target) && !headerMenuPanel?.contains(e.target))
            headerMenuPanel?.classList.remove('open');
    });

    // Modali
    const modaleTutorialOverlay   = document.getElementById('modale-tutorial-overlay');
    const modaleTutorialBody      = document.getElementById('modale-tutorial-body');
    const modaleTutorialCloseBtn  = document.getElementById('modale-tutorial-close');
    const guidaTestualeBtn        = document.getElementById('guida-testuale-btn');
    const videoGuidaBtn           = document.getElementById('video-guida-btn');
    const modaleGuidaOverlay      = document.getElementById('modale-guida-overlay');
    const modaleGuidaCloseBtn     = document.getElementById('modale-guida-close');
    const modaleVideoGuidaOverlay = document.getElementById('modale-video-guida-overlay');
    const modaleVideoGuidaCloseBtn = document.getElementById('modale-video-guida-close');
    const refreshAppBtn           = document.getElementById('refresh-app-btn');

    // ============================================================
    // PICKER FILATO — init con event delegation
    // ============================================================
    inizializzaPicker();

    // ============================================================
    // SKELETON LOADING (al posto dello spinner)
    // ============================================================
    function mostraSkeleton() {
        if (!contenitoreCatalogo) return;
        const cards = Array.from({length: 6}, () =>
            '<div class="skeleton skeleton-card"></div>'
        ).join('');
        contenitoreCatalogo.innerHTML = cards;
    }
    function nascondiSkeleton() {
        contenitoreCatalogo?.querySelectorAll('.skeleton').forEach(el => el.remove());
    }

    // ============================================================
    // NAVIGAZIONE SCHEDE
    // ============================================================
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.scheda).classList.add('active');
        });
    });

    // ============================================================
    // CARICAMENTO DATI
    // ============================================================
    mostraSkeleton();

    Promise.all([
        fetch(`${URL_CACHE_TUTORIALS}?v=${Date.now()}`).then(r => {
            if (!r.ok) throw new Error(`Errore cache: ${r.statusText}`);
            return r.json();
        }),
        fetch(URL_FILATI).then(r => r.json()),
        fetch(URL_FATTORI).then(r => r.json())
    ])
    .then(([tutorials, filati, fattori]) => {
        stato.dati.tuttiTutorials = tutorials;
        stato.dati.tuttiFilati    = filati;
        stato.dati.tuttiFilatiMap = new Map(filati.map(f => [f.id, f]));
        stato.dati.fattoriPunto   = fattori;

        popolaFiltriCatalogo();
        applicaDeepLink();
        renderAppCatalogo();
        aggiornaSelezioneFilato();   // filati filtrati per tipo progetto corrente
        aggiornaPuntiDisponibili();
    })
    .catch(err => {
        console.error('Errore caricamento:', err);
        if (contenitoreCatalogo)
            contenitoreCatalogo.innerHTML = '<p style="text-align:center;color:red;">Caricamento dati fallito. Riprova più tardi.</p>';
    })
    .finally(() => { nascondiSkeleton(); mostraBannerIOS(); aggiornaContatorPreferiti(); });

    // ============================================================
    // CATALOGO — filtri
    // ============================================================
    function popolaFiltriCatalogo() {
        const topAutrici = ['Cristiana Rossi', 'La Fata Tuttofare', 'La Mamu', 'Tessiland', 'Egle Breme'];
        const autriciSet = [...new Set(
            stato.dati.tuttiTutorials.map(t => (t.autrice || '').trim()).filter(Boolean)
        )];
        const top = topAutrici.filter(a => autriciSet.some(x => x.toLowerCase() === a.toLowerCase()));
        const resto = autriciSet.filter(a => !top.some(t => t.toLowerCase() === a.toLowerCase())).sort();
        const autrici = [...top, ...resto];
        dropdownAutrice._dropdown.setOptions(autrici.map(a => ({ value: a, label: a })));

        const filatiUsati = new Map();
        stato.dati.tuttiTutorials.forEach(t => {
            (t.filatiCollegati || []).forEach(f => {
                if (f.id && f.nome) filatiUsati.set(f.id, f.nome);
            });
        });
        dropdownFilato._dropdown.setOptions(
            [...filatiUsati.entries()]
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([id, nome]) => ({ value: id, label: nome }))
        );
    }

    // Deep link: ?filato=NomeFilato&autrice=NomeAutrice
    function applicaDeepLink() {
        const params = new URLSearchParams(window.location.search);

        const filato = params.get('filato');
        if (filato) {
            const match = [...dropdownFilato.querySelectorAll('.cd-option')].find(
                b => b.textContent.toLowerCase() === filato.toLowerCase()
            );
            if (match) {
                dropdownFilato._dropdown.setValue(match.dataset.value, match.textContent, true);
                stato.filtriCatalogo.filatoId = match.dataset.value;
            }
        }

        const autrice = params.get('autrice');
        if (autrice) {
            const match = [...dropdownAutrice.querySelectorAll('.cd-option')].find(
                b => b.textContent.toLowerCase() === autrice.toLowerCase()
            );
            if (match) {
                dropdownAutrice._dropdown.setValue(match.dataset.value, match.textContent, true);
                stato.filtriCatalogo.autrice = match.dataset.value;
            }
        }
    }

    searchInput.addEventListener('input', e => {
        stato.filtriCatalogo.termineRicerca = e.target.value.toLowerCase();
        renderAppCatalogo();
    });

    contenitoreCatalogo.addEventListener('click', e => {
        const favBtn = e.target.closest('.card-fav');
        if (favBtn) {
            e.stopPropagation();
            const id = favBtn.dataset.id;
            const now = togglePreferito(id);
            favBtn.classList.toggle('is-fav', now);
            return;
        }
        const card = e.target.closest('.card');
        if (card) apriModaleTutorial(card.dataset.id);
    });

    // Filtro preferiti toggle
    let soloPreferiti = false;
    document.getElementById('filtro-preferiti')?.addEventListener('click', () => {
        soloPreferiti = !soloPreferiti;
        document.getElementById('filtro-preferiti').classList.toggle('active', soloPreferiti);
        renderAppCatalogo();
    });

    function renderAppCatalogo() {
        let lista = stato.dati.tuttiTutorials;
        const { termineRicerca, autrice, filatoId } = stato.filtriCatalogo;

        if (termineRicerca) {
            lista = lista.filter(t =>
                (t.titolo    || '').toLowerCase().includes(termineRicerca) ||
                (t.autrice   || '').toLowerCase().includes(termineRicerca) ||
                (t.materiali || '').toLowerCase().includes(termineRicerca)
            );
        }
        if (autrice !== 'tutte') {
            lista = lista.filter(t => (t.autrice || '').trim() === autrice);
        }
        // Filtro filato: usa filatiCollegati (strutturato), non text matching
        if (filatoId) {
            lista = lista.filter(t =>
                (t.filatiCollegati || []).some(f => f.id === filatoId)
            );
        }
        if (soloPreferiti) {
            const pref = getPreferiti();
            lista = lista.filter(t => pref.includes(t.id));
        }

        renderCatalogo(lista);
    }

    function renderCatalogo(dati) {
        if (dati.length === 0) {
            contenitoreCatalogo.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">Nessun tutorial trovato per i filtri selezionati.</p>';
            return;
        }
        contenitoreCatalogo.innerHTML = dati.map(item => {
            const thumb = item.youtubeId
                ? `https://i.ytimg.com/vi/${item.youtubeId}/mqdefault.jpg`
                : `https://placehold.co/400x225/ede8f3/7c3fb1?text=No+video`;

            // Chips: da filatiCollegati strutturati, altrimenti materiali come chip
            let chipsHtml = '';
            if (item.filatiCollegati && item.filatiCollegati.length > 0) {
                const visibili = item.filatiCollegati.slice(0, 3);
                const extra    = item.filatiCollegati.length - 3;
                chipsHtml = visibili.map(f => `<span class="filato-chip">${esc(f.nome)}</span>`).join('');
                if (extra > 0) chipsHtml += `<span class="filato-chip">+${extra}</span>`;
            } else if (item.materiali) {
                chipsHtml = item.materiali.split(',').slice(0, 3)
                    .map(m => `<span class="filato-chip">${esc(m.trim())}</span>`).join('');
            }

            const fav = isPreferito(item.id);
            return `
                <div class="card" data-id="${esc(item.id)}">
                    <button class="card-fav ${fav ? 'is-fav' : ''}" data-id="${esc(item.id)}" aria-label="Preferito">
                        <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z"/></svg>
                    </button>
                    <img src="${safeUrl(thumb)}" alt="${esc(item.titolo)}" loading="lazy">
                    <div class="card-content">
                        <h3>${esc(item.titolo || 'Titolo non disponibile')}</h3>
                        <div class="card-autrice">${esc(item.autrice || '')}</div>
                        ${chipsHtml ? `<div class="card-chips"><span class="card-chips-label">Materiali</span>${chipsHtml}</div>` : ''}
                    </div>
                </div>`;
        }).join('');
    }

    // ============================================================
    // MODALE TUTORIAL
    // ============================================================
    function apriModaleTutorial(id) {
        const tutorial = stato.dati.tuttiTutorials.find(t => t.id === id);
        if (!tutorial) return;

        // Risolvi filati collegati (strutturati) con fallback text matching
        const filatiRiferimento = _risolviFilatiTutorial(tutorial);

        // Adatta taglia: non applicabile a bijoux/borse/accessori
        const tagDaEscludere = ['bijoux', 'borse e accessori', 'ricamo'];
        const mostraAdattaTaglia = !filatiRiferimento.some(f =>
            f.tags && f.tags.some(tag => tagDaEscludere.includes(tag.toLowerCase()))
        );

        // Sezione filati/materiali nella modale — label dinamico
        let sezioneFilatiHtml = '';
        if (tutorial.filatiCollegati && tutorial.filatiCollegati.length > 0) {
            const cardsHtml = tutorial.filatiCollegati.map(fc => {
                const f = stato.dati.tuttiFilatiMap.get(fc.id);
                const immagine   = f?.immagine || '';
                const comp       = (f?.composizione || []).join(' · ');
                const link       = f?.link || '';

                const imgHtml  = immagine
                    ? `<img src="${immagine}" alt="${fc.nome}" class="mfc-img" loading="lazy" onerror="this.style.display='none'">`
                    : `<div class="mfc-img mfc-img--vuota">🧶</div>`;
                const zoomBtn  = immagine
                    ? `<button class="mfc-zoom" data-src="${immagine}" data-nome="${fc.nome}" type="button" title="Ingrandisci">⊕</button>`
                    : '';
                const linkHtml = link && link !== '#'
                    ? `<a class="mfc-link" href="${link}" target="_blank" rel="noopener">Vedi prodotto ↗</a>`
                    : '';

                return `
                    <div class="modale-filato-card">
                        <div class="mfc-img-wrap">
                            ${imgHtml}
                            ${zoomBtn}
                        </div>
                        <div class="mfc-info">
                            <span class="mfc-nome">${fc.nome}</span>
                            ${comp ? `<span class="mfc-comp">${comp}</span>` : ''}
                            ${linkHtml}
                        </div>
                    </div>`;
            }).join('');

            sezioneFilatiHtml = `
                <div class="modale-info-row">
                    <span class="modale-label">Filati Tessiland</span>
                    <div class="modale-filati-cards">${cardsHtml}</div>
                </div>`;
        } else if (tutorial.materiali) {
            const chips = tutorial.materiali.split(',')
                .map(m => `<span class="filato-chip">${m.trim()}</span>`).join('');
            sezioneFilatiHtml = `
                <div class="modale-info-row">
                    <span class="modale-label">Materiali</span>
                    <div class="modale-filati-chips">${chips}</div>
                </div>`;
        }

        const btnAdatta = mostraAdattaTaglia
            ? `<button class="tool-tile" data-tool="adatta-taglia">
                <span class="tool-tile-icon">📐</span>
                <span class="tool-tile-label">Adatta<br>la Taglia</span>
               </button>`
            : '';

        modaleTutorialBody.innerHTML = `
            <div class="modale-tutorial-grid">
                <div class="modale-video">
                    <div class="yt-placeholder" data-id="${tutorial.youtubeId}">
                        <img src="https://i.ytimg.com/vi/${tutorial.youtubeId}/hqdefault.jpg" alt="${tutorial.titolo}" loading="lazy">
                        <div class="yt-play-overlay">
                            <div class="yt-play-btn">▶</div>
                            <span>Guarda il video</span>
                        </div>
                    </div>
                </div>
                <div class="modale-dettagli">
                    <div class="modale-titolo-row">
                        <h3>${tutorial.titolo}</h3>
                        <button class="card-fav modale-fav ${isPreferito(tutorial.id) ? 'is-fav' : ''}" data-id="${esc(tutorial.id)}" aria-label="Preferito">
                            <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z"/></svg>
                        </button>
                    </div>
                    <div class="modale-info-row">
                        <span class="modale-label">Autrice</span>
                        <span class="modale-value">${tutorial.autrice}</span>
                    </div>
                    ${sezioneFilatiHtml}
                    <div class="modale-azioni-tool">
                        <button class="tool-tile" data-tool="sostituisci-filato">
                            <span class="tool-tile-icon">🔄</span>
                            <span class="tool-tile-label">Sostituisci<br>il Filato</span>
                        </button>
                        ${btnAdatta}
                    </div>
                    <div id="tool-content-area" class="tool-content-area"></div>
                </div>
            </div>`;

        modaleTutorialOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Carica video YouTube al tap (lazy — non blocca il rendering su mobile)
        modaleTutorialBody.querySelector('.yt-placeholder')?.addEventListener('click', function() {
            const ytId = this.dataset.id;
            this.outerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1" title="${tutorial.titolo}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border-radius:var(--radius-sm);border:none;display:block;"></iframe>`;
        });

        modaleTutorialBody.querySelectorAll('.tool-btn, .tool-tile').forEach(btn => {
            btn.addEventListener('click', e => {
                const t = e.currentTarget;
                if (t.dataset.tool === 'sostituisci-filato') mostraToolSostituzione(tutorial, filatiRiferimento);
                if (t.dataset.tool === 'adatta-taglia')     mostraToolAdattamento(tutorial, filatiRiferimento);
            });
        });

        // Cuore preferito nella modale
        modaleTutorialBody.querySelector('.modale-fav')?.addEventListener('click', e => {
            const btn = e.currentTarget;
            const now = togglePreferito(btn.dataset.id);
            btn.classList.toggle('is-fav', now);
        });

        // Zoom sulle miniature filato nella modale
        modaleTutorialBody.querySelectorAll('.mfc-zoom').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                apriZoom(btn.dataset.src, btn.dataset.nome);
            });
        });
    }

    // Risolve i filati di un tutorial: prima da filatiCollegati (strutturato), poi fallback text matching
    function _risolviFilatiTutorial(tutorial) {
        if (tutorial.filatiCollegati && tutorial.filatiCollegati.length > 0) {
            return tutorial.filatiCollegati
                .map(fc => stato.dati.tuttiFilatiMap.get(fc.id))
                .filter(Boolean);
        }
        // Fallback legacy: text matching su materiali
        const mat = (tutorial.materiali || '').toLowerCase();
        return stato.dati.tuttiFilati.filter(f =>
            mat.includes(f.nome.toLowerCase().trim())
        );
    }

    // ── Vista tool a schermo pieno nella modale ──────────────
    function apriVistaToolInModale(titoloTool, tutorial) {
        modaleTutorialBody.innerHTML = `
            <button id="modale-tool-back" class="modale-back-btn">← ${tutorial.titolo}</button>
            <h3 class="modale-tool-titolo">${titoloTool}</h3>
            <div id="tool-main-area"></div>`;
        modaleTutorialBody.closest('.modale-content').scrollTop = 0;
        document.getElementById('modale-tool-back').addEventListener('click', () => {
            apriModaleTutorial(tutorial.id);
        });
        return document.getElementById('tool-main-area');
    }

    // ── Tool Sostituisci Filato ───────────────────────────────
    function mostraToolSostituzione(tutorial, filatiRiferimento) {
        const area = apriVistaToolInModale('Sostituisci il Filato', tutorial);

        if (filatiRiferimento.length === 0) {
            area.innerHTML = '<p class="info-tool">Non è stato possibile identificare un filato di riferimento compatibile per questo tutorial.</p>';
            return;
        }
        if (filatiRiferimento.length === 1) {
            mostraFiltriAlternative(filatiRiferimento[0]);
            return;
        }

        const bottoni = filatiRiferimento.map(f =>
            `<button class="calcolo-btn" data-filato-id="${f.id}">${f.nome}</button>`
        ).join('');
        area.innerHTML = `<p style="color:var(--text-muted);margin-bottom:0.5rem;">Quale filato vuoi sostituire?</p>${bottoni}`;

        area.querySelectorAll('[data-filato-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const f = stato.dati.tuttiFilatiMap.get(btn.dataset.filatoId);
                if (f) mostraFiltriAlternative(f);
            });
        });
    }

    function mostraFiltriAlternative(filatoOriginale) {
        const area = document.getElementById('tool-main-area');

        // Tag disponibili: solo quelli presenti nelle alternative già filtrate per categoria
        const catOrig = _categorieEsclusive(filatoOriginale);
        const alternativiBase = stato.dati.tuttiFilati.filter(f => {
            if (f.id === filatoOriginale.id || !f.titoloMetrico || f.stato !== 'Attivo') return false;
            const catAlt = _categorieEsclusive(f);
            if (catOrig.length > 0) return catOrig.some(c => catAlt.includes(c));
            return catAlt.length === 0;
        });
        const tagDisponibili = [...new Set(alternativiBase.flatMap(f => f.tags || []))].sort();
        const opzioniTag = tagDisponibili.map(tag => `<option value="${tag}">${tag}</option>`).join('');

        area.innerHTML = `
            <p style="color:var(--text-muted);margin-bottom:1rem;">Alternative a <strong>${filatoOriginale.nome}</strong></p>
            <div class="form-group">
                <label for="filtro-tag-sostituzione">Filtra per tipologia</label>
                <select id="filtro-tag-sostituzione">
                    <option value="tutti">Tutte le alternative compatibili</option>
                    ${opzioniTag}
                </select>
            </div>
            <div id="risultato-sostituzione" class="risultato-box" style="text-align:left;margin-top:1rem;display:none;"></div>`;

        document.getElementById('filtro-tag-sostituzione').addEventListener('change', () => mostraRisultatiSostituzione(filatoOriginale));
        mostraRisultatiSostituzione(filatoOriginale);
    }

    // ── Regole compatibilità per categoria ───────────────────
    const CATEGORIE_ESCLUSIVE = ['bijoux', 'borse e accessori', 'ricamo'];

    function _tags(filato) {
        return (filato.tags || []).map(t => t.toLowerCase());
    }
    function _categorieEsclusive(filato) {
        return _tags(filato).filter(t => CATEGORIE_ESCLUSIVE.includes(t));
    }
    function _isPerInserto(filato) {
        return _tags(filato).includes('per inserto');
    }

    // ── Indicatore spessore filato — category-aware ──────────
    function _spessoreInfo(tm, categoria) {
        if (!tm || tm <= 0) return null;
        const cfg = SPESSORE_CONFIG[categoria] || SPESSORE_CONFIG.abbigliamento;
        for (const r of cfg.grades) {
            if (tm < r.max) return { grade: r.grade, label: r.label };
        }
        // fallback: usa l'ultimo grade
        const last = cfg.grades[cfg.grades.length - 1];
        return { grade: last.grade, label: last.label };
    }

    // categoriaContesto: forza la scala del contesto (es. borse picker → usa scala borse
    // anche per filati con tag ricamo/bijoux che hanno una scala propria)
    function _spessoreHtml(filato, categoriaContesto) {
        const tm  = filato.titoloMetrico;
        const cat = categoriaContesto || _categoriaFilato(filato);
        const info = _spessoreInfo(tm, cat);
        if (!info) return '';
        const dots = [1,2,3,4,5].map(i =>
            `<span class="fc-sp-dot${i <= info.grade ? ' active' : ''}"></span>`
        ).join('');
        return `<div class="fc-spessore" title="${tm.toFixed(1)} m/g">
            <div class="fc-sp-dots">${dots}</div>
            <span class="fc-sp-label">${info.label}</span>
        </div>`;
    }

    // ── Preview stima rapida (client-side) ────────────────────
    function calcolaPreviewGomitoli(filato) {
        if (!filato?.titoloMetrico || !filato?.peso) return null;

        const tipo = tipoProgettoSelect.value;
        const per  = tipoProgettoPersonalizzatoSelect.value;
        const lav  = lavorazioneSelect.value;
        const puntoId = puntoSelect.value;
        const tensione = [0.9, 1.0, 1.1][parseInt(tensioneSlider.value) + 1];
        const puntoFattore = stato.dati.fattoriPunto[lav]?.[puntoId]?.fattore || 1.0;
        const campionePeso = campioneCheck.checked
            ? parseFloat(document.getElementById('campione-peso')?.value) || 0
            : 0;

        let areaCm2 = 0;
        const n = id => parseFloat(document.getElementById(id)?.value) || 0;

        if (tipo === 'maglia') {
            areaCm2 = (n('corpo-larghezza') * n('corpo-altezza') * 2) +
                      (n('manica-larghezza') * n('manica-altezza') * 2);
        } else if (['coperta','sciarpa','cappello'].includes(tipo)) {
            areaCm2 = n('progetto-larghezza') * n('progetto-altezza');
        } else if (tipo === 'personalizzato') {
            if (per === 'borsa') {
                areaCm2 = (n('borsa-larghezza') * n('borsa-altezza') * 2) +
                           (n('tracolla-lunghezza') * n('tracolla-larghezza'));
            } else if (per === 'scialle-triangolare') {
                areaCm2 = (n('scialle-base') * n('scialle-altezza')) / 2;
            }
            // bijoux: calcolo troppo specifico, niente preview
        }

        if (areaCm2 <= 0) return null;

        const grammi = campionePeso > 0
            ? areaCm2 * (campionePeso / 100)
            : (areaCm2 / 10000) * 500 * (2.0 / filato.titoloMetrico) * puntoFattore * tensione * 1.15;

        const gomitoli = Math.ceil(grammi / filato.peso);
        return { grammi: Math.round(grammi), gomitoli };
    }

    function aggiornaPreview() {
        const preview = document.getElementById('filato-preview');
        if (!preview) return;
        const id = filatoSelect.value;
        if (!id) { preview.className = 'filato-preview'; preview.textContent = ''; return; }

        const f = stato.dati.tuttiFilatiMap.get(id);
        const ris = calcolaPreviewGomitoli(f);

        if (!ris) {
            preview.className = 'filato-preview filato-preview--hint';
            preview.textContent = 'Inserisci le misure per vedere la stima';
        } else {
            const label = ris.gomitoli === 1 ? 'gomitolo' : 'gomitoli';
            preview.className = 'filato-preview filato-preview--result';
            preview.innerHTML = `Con <strong>${f.nome}</strong>: circa <strong>${ris.gomitoli} ${label}</strong> <span class="preview-grammi">(${ris.grammi} gr)</span>`;
        }
    }

    // Badge stagionalità visivo
    function _badgeStagione(filato) {
        const t = _tags(filato);
        if (t.includes('primavera-estate')) return '<span class="badge-stagione badge-pe">🌸 P-E</span>';
        if (t.includes('autunno-inverno'))  return '<span class="badge-stagione badge-ai">❄️ A-I</span>';
        if (t.includes('4 stagioni'))       return '<span class="badge-stagione badge-4s">✦ 4 stag.</span>';
        return '';
    }

    // Descrizione stagione del filato originale (per il contesto)
    function _descrizioneStagione(filato) {
        const t = _tags(filato);
        if (t.includes('primavera-estate')) return 'filato primavera-estate 🌸';
        if (t.includes('autunno-inverno'))  return 'filato autunno-inverno ❄️';
        if (t.includes('4 stagioni'))       return 'filato 4 stagioni ✦';
        return null;
    }

    // Restituisce i filati alternativi compatibili per categoria
    // includiAbbigliamento: usato solo per borse, aggiunge filati da abbigliamento generico
    function _filtraAlternativi(originale, includiAbbigliamento = false) {
        const catOrig       = _categorieEsclusive(originale);
        const origPerInserto = _isPerInserto(originale);

        return stato.dati.tuttiFilati.filter(f => {
            if (f.id === originale.id || !f.titoloMetrico || f.stato !== 'Attivo') return false;
            const catAlt       = _categorieEsclusive(f);
            const altPerInserto = _isPerInserto(f);

            // bijoux ↔ ricamo: si sostituiscono tra loro, ma escludiamo filati che hanno anche borse
            if (catOrig.includes('bijoux') || catOrig.includes('ricamo')) {
                return (catAlt.includes('bijoux') || catAlt.includes('ricamo'))
                    && !catAlt.includes('borse e accessori');
            }
            // borse e accessori
            if (catOrig.includes('borse e accessori')) {
                if (catAlt.includes('borse e accessori')) return true;
                // toggle attivo: includi anche abbigliamento generico
                if (includiAbbigliamento) return catAlt.length === 0 && !altPerInserto;
                return false;
            }
            // per inserto → solo per inserto
            if (origPerInserto) return altPerInserto;
            // abbigliamento generico → no categorie esclusive, no per inserto
            return catAlt.length === 0 && !altPerInserto;
        });
    }

    function mostraFiltriAlternative(filatoOriginale) {
        const area    = document.getElementById('tool-main-area');
        const catOrig = _categorieEsclusive(filatoOriginale);
        const isBorse = catOrig.includes('borse e accessori');

        const _aggiornaDropdown = (includiAbb) => {
            const alt = _filtraAlternativi(filatoOriginale, includiAbb);
            const tag = [...new Set(alt.flatMap(f => f.tags || []))].sort();
            const sel = document.getElementById('filtro-tag-sostituzione');
            sel.innerHTML = '<option value="tutti">Tutte le alternative compatibili</option>' +
                tag.map(t => `<option value="${t}">${t}</option>`).join('');
            sel.value = 'tutti';
        };

        // Dropdown tags iniziale (toggle abbigliamento OFF)
        const altBase   = _filtraAlternativi(filatoOriginale, false);
        const tagBase   = [...new Set(altBase.flatMap(f => f.tags || []))].sort();
        const opzioniTag = tagBase.map(t => `<option value="${t}">${t}</option>`).join('');

        const toggleHtml = isBorse ? `
            <button id="toggle-abbigliamento-btn" class="toggle-btn" data-attivo="false">
                + Includi filati da abbigliamento
            </button>` : '';

        const stagione = _descrizioneStagione(filatoOriginale);
        const contestoHtml = `
            <div class="contesto-originale">
                <span>Alternativa a <strong>${filatoOriginale.nome}</strong></span>
                ${stagione ? `<span class="contesto-stagione">${stagione}</span>` : ''}
            </div>`;

        area.innerHTML = `
            ${contestoHtml}
            ${toggleHtml}
            <div class="form-group" ${isBorse ? 'style="margin-top:0.75rem"' : ''}>
                <label for="filtro-tag-sostituzione">Filtra per tipologia</label>
                <select id="filtro-tag-sostituzione">
                    <option value="tutti">Tutte le alternative compatibili</option>
                    ${opzioniTag}
                </select>
            </div>
            <div id="risultato-sostituzione" class="risultato-box" style="text-align:left;margin-top:1rem;display:none;"></div>`;

        document.getElementById('filtro-tag-sostituzione')
            .addEventListener('change', () => mostraRisultatiSostituzione(filatoOriginale));

        if (isBorse) {
            document.getElementById('toggle-abbigliamento-btn').addEventListener('click', e => {
                const attivo = e.target.dataset.attivo === 'true';
                e.target.dataset.attivo = String(!attivo);
                e.target.classList.toggle('toggle-btn--attivo', !attivo);
                e.target.textContent = !attivo
                    ? '✓ Includi filati da abbigliamento'
                    : '+ Includi filati da abbigliamento';
                _aggiornaDropdown(!attivo);
                mostraRisultatiSostituzione(filatoOriginale);
            });
        }

        mostraRisultatiSostituzione(filatoOriginale);
    }

    function mostraRisultatiSostituzione(filatoOriginale) {
        const tagSelezionato = document.getElementById('filtro-tag-sostituzione').value;
        const box            = document.getElementById('risultato-sostituzione');
        const originale      = stato.dati.tuttiFilatiMap.get(filatoOriginale.id);

        if (!originale || !originale.titoloMetrico) {
            box.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Dati tecnici insufficienti. Aggiorna il filato in MTT e riprova.</p>';
            box.style.display = 'block';
            return;
        }

        const includiAbb = document.getElementById('toggle-abbigliamento-btn')?.dataset.attivo === 'true';
        let alternativi  = _filtraAlternativi(originale, includiAbb);

        if (tagSelezionato !== 'tutti') {
            alternativi = alternativi.filter(f =>
                _tags(f).includes(tagSelezionato.toLowerCase())
            );
        }

        const risultati = alternativi.map(f => {
            const diff = Math.abs(f.titoloMetrico - originale.titoloMetrico) / originale.titoloMetrico;
            return { ...f, efficienza: Math.round((1 - diff) * 100) };
        }).filter(f => f.efficienza >= 80).sort((a, b) => b.efficienza - a.efficienza);

        if (risultati.length === 0) {
            box.innerHTML = '<p style="padding:1rem;color:var(--text-muted);">Nessuna alternativa trovata per questa tipologia.</p>';
            box.style.display = 'block';
            return;
        }

        const LIMITE = 6;
        const _renderRiga = f => `
            <li>
                <a class="risultato-link" href="${f.link}" target="_blank" rel="noopener">
                    ${f.nome} <span class="link-icon">↗</span>
                </a>
                <div class="risultato-meta">
                    ${_badgeStagione(f)}
                    <span class="efficienza">${f.efficienza}%</span>
                </div>
            </li>`;

        const visibili = risultati.slice(0, LIMITE);
        const nascosti = risultati.slice(LIMITE);

        let html = '<ul>' + visibili.map(_renderRiga).join('') + '</ul>';
        if (nascosti.length > 0) {
            html += `<button class="mostra-altri-btn" id="mostra-altri-btn">
                Vedi tutte le ${risultati.length} alternative
            </button>`;
        }

        box.innerHTML = html;
        box.style.display = 'block';

        document.getElementById('mostra-altri-btn')?.addEventListener('click', e => {
            e.target.remove();
            const ul = box.querySelector('ul');
            ul.innerHTML += nascosti.map(_renderRiga).join('');
        });
    }

    // ── Tool Adatta Taglia ────────────────────────────────────
    function mostraToolAdattamento(tutorial, filatiRiferimento) {
        const area = apriVistaToolInModale('Adatta alla Tua Taglia', tutorial);
        const taglieStandard = [40, 42, 44, 46, 48, 50, 52, 54];
        const taglieEstese   = [40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60];

        area.innerHTML = `
            <p class="info-tool" style="margin-bottom:1.25rem;">Inserisci i dati del progetto originale e la tua taglia per una stima del fabbisogno di filato.</p>
            <div class="form-group">
                <label for="taglia-originale">Taglia del progetto nel video</label>
                <select id="taglia-originale">
                    ${taglieStandard.map(t => `<option value="${t}">Taglia ${t}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="peso-originale-taglia">Quantità filato usata nel video (grammi)</label>
                <input type="number" id="peso-originale-taglia" placeholder="Es: 450">
            </div>
            <div class="form-group">
                <label for="taglia-desiderata">La tua taglia</label>
                <select id="taglia-desiderata">
                    ${taglieEstese.map(t => `<option value="${t}">Taglia ${t}</option>`).join('')}
                </select>
            </div>
            <button id="calcola-adattamento-btn" class="calcolo-btn">Calcola</button>
            <div id="risultato-adattamento" class="risultato-box" style="margin-top:1rem;display:none;"></div>`;

        document.getElementById('calcola-adattamento-btn').addEventListener('click', () => {
            const tagliaOrig  = parseInt(document.getElementById('taglia-originale').value);
            const pesoOrig    = parseFloat(document.getElementById('peso-originale-taglia').value);
            const tagliaDesid = parseInt(document.getElementById('taglia-desiderata').value);
            const box         = document.getElementById('risultato-adattamento');

            if (!tagliaOrig || !pesoOrig || !tagliaDesid) {
                box.innerHTML = '<p style="color:red;padding:1rem;">Compila tutti i campi.</p>';
                box.style.display = 'block';
                return;
            }

            const nuovoPeso = (pesoOrig / tagliaOrig) * tagliaDesid;
            const filatoRef = filatiRiferimento[0] || null;
            let gomitoliHtml = '';
            if (filatoRef && filatoRef.peso > 0) {
                const n = Math.ceil(nuovoPeso / filatoRef.peso);
                gomitoliHtml = `<div class="risultato-finale">🛒 Circa <strong>${n} gomitoli</strong> di <i>${filatoRef.nome}</i>.</div>`;
            }

            box.innerHTML = `
                <div class="risultato-sezione">
                    <p>Stima per Taglia ${tagliaDesid}</p>
                    <div class="risultato-valore">${Math.round(nuovoPeso)} gr</div>
                    ${gomitoliHtml}
                </div>`;
            box.style.display = 'block';
        });
    }

    modaleTutorialCloseBtn.addEventListener('click', () => {
        modaleTutorialOverlay.classList.add('hidden');
        modaleTutorialBody.innerHTML = '';
        document.body.style.overflow = '';
    });

    // ============================================================
    // TOOL CALCOLO FILATO
    // ============================================================
    function popolaSelect(el, dati, placeholder) {
        if (!el) return;
        el.innerHTML = `<option value="">-- ${placeholder} --</option>`;
        dati.forEach(item => el.appendChild(new Option(item.nome, item.id || item.value)));
    }

    const PUNTO_DEFAULT = {
        uncinetto: 'single_crochet',    // Maglia bassa — il più comune
        ferri:     'stockinette_stitch' // Maglia rasata — il più comune
    };

    function aggiornaPuntiDisponibili() {
        const lav = lavorazioneSelect.value;
        const p   = stato.dati.fattoriPunto;
        if (p && p[lav]) {
            const punti = Object.keys(p[lav]).map(k => ({ id: k, nome: p[lav][k].nome }));
            popolaSelect(puntoSelect, punti, 'Scegli un punto');
            // Pre-seleziona il punto di default per la lavorazione
            const defaultId = PUNTO_DEFAULT[lav];
            if (defaultId && puntoSelect.querySelector(`option[value="${defaultId}"]`)) {
                puntoSelect.value = defaultId;
            }
        }
    }

    // Toggle sezione impostazioni avanzate
    document.getElementById('avanzate-toggle')?.addEventListener('click', () => {
        const section = document.getElementById('avanzate-section');
        const toggle  = document.getElementById('avanzate-toggle');
        const aperta  = !section.classList.contains('hidden');
        section.classList.toggle('hidden', aperta);
        toggle.setAttribute('aria-expanded', String(!aperta));
        toggle.querySelector('.avanzate-arrow').textContent = aperta ? '▼' : '▲';
    });

    // Filtra i filati del catalogo in base al tipo di progetto scelto (solo Attivi)
    function _filatiPerProgetto(tipoProgetto, tipoPersonalizzato) {
        const attivi = stato.dati.tuttiFilati.filter(f => f.stato === 'Attivo');
        if (tipoProgetto === 'personalizzato') {
            if (tipoPersonalizzato === 'borsa') {
                return attivi.filter(f => _tags(f).includes('borse e accessori'));
            }
            if (tipoPersonalizzato === 'bijoux') {
                return attivi.filter(f => {
                    const cat = _categorieEsclusive(f);
                    return (cat.includes('bijoux') || cat.includes('ricamo'))
                        && !cat.includes('borse e accessori');
                });
            }
        }
        // abbigliamento generico: maglia, coperta, sciarpa, cappello, scialle
        return attivi.filter(f => _categorieEsclusive(f).length === 0 && !_isPerInserto(f));
    }

    // Scale spessore per categoria — range e labels differenziati
    const SPESSORE_CONFIG = {
        abbigliamento: {
            pills: [
                { val: 'grosso',  label: 'Grosso',  min: 0,  max: 2  },
                { val: 'medio',   label: 'Medio',   min: 2,  max: 4  },
                { val: 'leggero', label: 'Leggero', min: 4,  max: 15 },
            ],
            grades: [
                { max: 2,   grade: 5, label: 'Maxi'    },
                { max: 4,   grade: 4, label: 'Grosso'  },
                { max: 8,   grade: 3, label: 'Medio'   },
                { max: 15,  grade: 2, label: 'Leggero' },
                { max: 9999,grade: 1, label: 'Fine'    },
            ]
        },
        borse: {
            pills: [
                { val: 'mega',    label: 'Mega',    min: 0,    max: 0.5 },
                { val: 'grosso',  label: 'Grosso',  min: 0.5,  max: 1   },
                { val: 'medio',   label: 'Medio',   min: 1,    max: 2   },
                { val: 'sottile', label: 'Sottile', min: 2,    max: 9999},
            ],
            grades: [
                { max: 0.5, grade: 5, label: 'Mega'    },
                { max: 1,   grade: 4, label: 'Grosso'  },
                { max: 2,   grade: 3, label: 'Medio'   },
                { max: 9999,grade: 1, label: 'Sottile' },
            ]
        },
        bijoux: {
            pills: [
                { val: 'strutturato', label: 'Strutturato', min: 0,   max: 2.5 },
                { val: 'medio',       label: 'Medio',       min: 2.5, max: 5   },
                { val: 'fine',        label: 'Fine',        min: 5,   max: 9999},
            ],
            grades: [
                { max: 2.5, grade: 5, label: 'Strutturato' },
                { max: 5,   grade: 3, label: 'Medio'       },
                { max: 9999,grade: 1, label: 'Fine'        },
            ]
        }
    };

    function inizializzaPicker() {
        // Event delegation — funziona anche con pills generate dinamicamente
        ['picker-stagione', 'picker-peso'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', e => {
                const pill = e.target.closest('.picker-pill');
                if (!pill) return;
                document.querySelectorAll(`#${id} .picker-pill`).forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                aggiornaSelezioneFilato();
            });
        });
    }

    // Determina la categoria spessore di un filato dai suoi tag
    function _categoriaFilato(filato) {
        const cat = _categorieEsclusive(filato);
        if (cat.includes('bijoux') || cat.includes('ricamo')) return 'bijoux';
        if (cat.includes('borse e accessori')) return 'borse';
        return 'abbigliamento';
    }

    // Determina la categoria picker in base al tipo progetto selezionato
    function _categoriaPicker() {
        const tipo = tipoProgettoSelect.value;
        const per  = tipoProgettoPersonalizzatoSelect.value;
        if (tipo === 'personalizzato' && per === 'bijoux') return 'bijoux';
        if (tipo === 'personalizzato' && per === 'borsa')  return 'borse';
        return 'abbigliamento';
    }

    // Render pill spessore per la categoria attiva
    function renderPillsPeso(categoria) {
        const container = document.getElementById('picker-peso');
        if (!container) return;
        const cfg = SPESSORE_CONFIG[categoria] || SPESSORE_CONFIG.abbigliamento;
        container.innerHTML =
            `<button class="picker-pill active" data-val="" type="button">Tutti</button>` +
            cfg.pills.map(p =>
                `<button class="picker-pill" data-val="${p.val}" type="button">${p.label}</button>`
            ).join('');
    }

    // Aggiorna filtri picker quando cambia il tipo progetto (NON ad ogni selezione filato)
    function aggiornaPicerFiltriVisibilità() {
        const categoria = _categoriaPicker();

        // Stagione: nascosta per bijoux e borse
        const rowStagione = document.getElementById('picker-stagione')?.closest('.picker-row');
        const nascondiStagione = categoria === 'bijoux' || categoria === 'borse';
        if (rowStagione) rowStagione.style.display = nascondiStagione ? 'none' : '';
        if (nascondiStagione) {
            document.querySelectorAll('#picker-stagione .picker-pill').forEach(p => p.classList.remove('active'));
            document.querySelector('#picker-stagione .picker-pill[data-val=""]')?.classList.add('active');
        }

        // Spessore: aggiorna pill solo se la categoria è cambiata
        const attuale = document.getElementById('picker-peso')?.dataset.categoria;
        if (attuale !== categoria) {
            renderPillsPeso(categoria);
            document.getElementById('picker-peso').dataset.categoria = categoria;
        }
    }

    function aggiornaSelezioneFilato() {
        const tipo = tipoProgettoSelect.value;
        const per  = tipo === 'personalizzato' ? tipoProgettoPersonalizzatoSelect.value : null;

        let filati = _filatiPerProgetto(tipo, per);

        // Filtro stagionalità (solo se visibile)
        const stagione = document.querySelector('#picker-stagione .picker-pill.active')?.dataset.val || '';
        if (stagione) {
            filati = filati.filter(f => _tags(f).includes(stagione));
        }

        // Filtro spessore — range dalla config della categoria corrente
        const peso = document.querySelector('#picker-peso .picker-pill.active')?.dataset.val || '';
        if (peso) {
            const categoria = _categoriaPicker();
            const cfg = SPESSORE_CONFIG[categoria] || SPESSORE_CONFIG.abbigliamento;
            const range = cfg.pills.find(p => p.val === peso);
            if (range) filati = filati.filter(f => f.titoloMetrico >= range.min && f.titoloMetrico < range.max);
        }

        // Aggiorna contatore
        const counter = document.getElementById('picker-counter');
        if (counter) {
            counter.textContent = filati.length > 0
                ? `${filati.length} filati disponibili`
                : 'Nessun filato per questi filtri';
            counter.style.color = filati.length > 0 ? 'var(--text-muted)' : 'var(--primary)';
        }

        // Render card grid
        const grid = document.getElementById('filato-card-grid');
        if (!grid) { popolaSelect(filatoSelect, filati, 'Scegli un filato'); return; }

        const selezionato   = filatoSelect.value;
        const catContesto   = _categoriaPicker();

        if (filati.length === 0) {
            grid.innerHTML = '<p class="picker-empty">Nessun filato corrisponde ai filtri scelti.</p>';
            filatoSelect.innerHTML = '<option value="">-- Scegli un filato --</option>';
            return;
        }

        grid.innerHTML = filati.map(f => {
            const comp = (f.composizione || []).slice(0, 2).join(' · ');
            const imgHtml = f.immagine
                ? `<img src="${f.immagine}" alt="${f.nome}" class="fc-img" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="fc-img fc-img--vuota">🧶</div>`;
            const zoomBtn = f.immagine
                ? `<button class="fc-zoom" data-src="${f.immagine}" data-nome="${f.nome}" type="button" title="Ingrandisci">⊕</button>`
                : '';
            const isAttivo = selezionato === f.id;
            return `
                <div class="filato-card-picker ${isAttivo ? 'filato-card-picker--attiva' : ''}" data-id="${f.id}">
                    <div class="fc-img-wrap">
                        ${imgHtml}
                        ${zoomBtn}
                    </div>
                    <div class="fc-body">
                        <div class="fc-nome-row">
                            <span class="fc-nome">${f.nome}</span>
                            ${f.link && f.link !== '#'
                                ? `<a class="fc-link-inline" href="${f.link}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>`
                                : ''}
                        </div>
                        ${comp ? `<span class="fc-comp">${comp}</span>` : ''}
                        <div class="fc-footer-row">
                            ${_spessoreHtml(f, catContesto)}
                            ${_badgeStagione(f)}
                        </div>
                    </div>
                </div>`;
        }).join('');

        // Aggiorna select nascosta
        filatoSelect.innerHTML = '<option value="">-- Scegli un filato --</option>';
        filati.forEach(f => filatoSelect.appendChild(new Option(f.nome, f.id)));
        if (selezionato && filati.find(f => f.id === selezionato)) filatoSelect.value = selezionato;

        // Click su card → selezione + preview
        grid.querySelectorAll('.filato-card-picker').forEach(card => {
            card.addEventListener('click', e => {
                if (e.target.closest('.fc-zoom')) return;
                grid.querySelectorAll('.filato-card-picker').forEach(c => c.classList.remove('filato-card-picker--attiva'));
                card.classList.add('filato-card-picker--attiva');
                filatoSelect.value = card.dataset.id;
                aggiornaPreview();
            });
        });

        // Click zoom → lightbox
        grid.querySelectorAll('.fc-zoom').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                apriZoom(btn.dataset.src, btn.dataset.nome);
            });
        });
    }

    // ── Zoom lightbox ─────────────────────────────────────────
    const zoomOverlay = document.getElementById('zoom-overlay');
    const zoomImg     = document.getElementById('zoom-img');
    const zoomClose   = document.getElementById('zoom-close');

    function apriZoom(src, nome) {
        zoomImg.src = src;
        zoomImg.alt = nome;
        zoomOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
    function chiudiZoom() {
        zoomOverlay.classList.add('hidden');
        zoomImg.src = '';
        document.body.style.overflow = '';
    }
    zoomClose?.addEventListener('click', chiudiZoom);
    zoomOverlay?.addEventListener('click', e => { if (e.target === zoomOverlay) chiudiZoom(); });

    function aggiornaVisibilitaMisure() {
        if (tipoProgettoSelect.value === 'personalizzato') {
            campiMisureStandardContainer.innerHTML = '';
            campiMisureStandardContainer.classList.add('hidden');
            campiMisurePersonalizzateContainer.classList.remove('hidden');
            aggiornaCampiMisurePersonalizzate();
        } else {
            campiMisureStandardContainer.classList.remove('hidden');
            campiMisurePersonalizzateContainer.classList.add('hidden');
            campiMisurePersonalizzateDinamici.innerHTML = '';
            tipoProgettoPersonalizzatoSelect.value = '';
            aggiornaCampiMisureStandard();
        }
        aggiornaPicerFiltriVisibilità();
        aggiornaSelezioneFilato();
    }

    function aggiornaCampiMisureStandard() {
        const tipo = tipoProgettoSelect.value;
        let html = '';
        switch (tipo) {
            case 'coperta': case 'sciarpa':
                html = `<h4>Misure</h4>
                    <div class="form-group"><label for="progetto-larghezza">Larghezza (cm)</label><input type="number" id="progetto-larghezza" placeholder="Es: 80"></div>
                    <div class="form-group"><label for="progetto-altezza">Altezza (cm)</label><input type="number" id="progetto-altezza" placeholder="Es: 120"></div>`;
                break;
            case 'maglia':
                html = `<h4>Misure — pannello frontale</h4>
                    <div class="form-group"><label for="corpo-larghezza">Larghezza Corpo (cm)</label><input type="number" id="corpo-larghezza" placeholder="Metà circonferenza"></div>
                    <div class="form-group"><label for="corpo-altezza">Altezza Corpo (cm)</label><input type="number" id="corpo-altezza" placeholder="Dalle spalle all'orlo"></div>
                    <h4>Misure — manica singola</h4>
                    <div class="form-group"><label for="manica-larghezza">Larghezza Manica (cm)</label><input type="number" id="manica-larghezza" placeholder="Aperta e piatta"></div>
                    <div class="form-group"><label for="manica-altezza">Lunghezza Manica (cm)</label><input type="number" id="manica-altezza" placeholder="Dalla spalla al polso"></div>`;
                break;
            case 'cappello':
                html = `<h4>Misure</h4>
                    <div class="form-group"><label for="progetto-larghezza">Circonferenza (cm)</label><input type="number" id="progetto-larghezza" placeholder="Es: 56"></div>
                    <div class="form-group"><label for="progetto-altezza">Altezza (cm)</label><input type="number" id="progetto-altezza" placeholder="Es: 25"></div>`;
                break;
        }
        campiMisureStandardContainer.innerHTML = html;
    }

    function aggiornaCampiMisurePersonalizzate() {
        const tipo = tipoProgettoPersonalizzatoSelect.value;
        let html = '';
        switch (tipo) {
            case 'borsa':
                html = `
                    <div class="form-group"><label for="borsa-larghezza">Larghezza Borsa (cm)</label><input type="number" id="borsa-larghezza"></div>
                    <div class="form-group"><label for="borsa-altezza">Altezza Borsa (cm)</label><input type="number" id="borsa-altezza"></div>
                    <div class="form-group"><label for="tracolla-lunghezza">Lunghezza Tracolla (cm)</label><input type="number" id="tracolla-lunghezza"></div>
                    <div class="form-group"><label for="tracolla-larghezza">Larghezza Tracolla (cm)</label><input type="number" id="tracolla-larghezza"></div>`;
                break;
            case 'scialle-triangolare':
                html = `
                    <div class="form-group"><label for="scialle-base">Base Triangolo (cm)</label><input type="number" id="scialle-base"></div>
                    <div class="form-group"><label for="scialle-altezza">Altezza Triangolo (cm)</label><input type="number" id="scialle-altezza"></div>`;
                break;
            case 'bijoux':
                html = `
                    <div class="form-group">
                        <label for="tipo-bijoux">Tipo di bijoux</label>
                        <select id="tipo-bijoux">
                            <option value="">-- Seleziona --</option>
                            <option value="bracciale">Bracciale</option>
                            <option value="orecchini">Orecchini (la coppia)</option>
                            <option value="collana">Collana</option>
                        </select>
                    </div>
                    <div id="campi-misure-bijoux-dinamici"></div>`;
                break;
        }
        campiMisurePersonalizzateDinamici.innerHTML = html;
        document.getElementById('tipo-bijoux')?.addEventListener('change', aggiornaCampiBijoux);
        aggiornaPicerFiltriVisibilità();
        aggiornaSelezioneFilato();
    }

    function aggiornaCampiBijoux() {
        const tipo      = document.getElementById('tipo-bijoux')?.value;
        const container = document.getElementById('campi-misure-bijoux-dinamici');
        if (!tipo || !container) return;
        let html = '';
        switch (tipo) {
            case 'bracciale':
                html = `
                    <div class="form-group"><label for="bracciale-lunghezza">Circonferenza Polso (cm)</label><input type="number" id="bracciale-lunghezza"></div>
                    <div class="form-group"><label for="bracciale-larghezza">Larghezza Fascia (cm)</label><input type="number" id="bracciale-larghezza"></div>`;
                break;
            case 'orecchini':
                html = `<div class="form-group"><label for="orecchino-diametro">Diametro di 1 orecchino (cm)</label><input type="number" id="orecchino-diametro"></div>`;
                break;
            case 'collana':
                html = `
                    <div class="form-group"><label for="collana-lunghezza">Lunghezza Collana (cm)</label><input type="number" id="collana-lunghezza"></div>
                    <div class="form-group"><label for="collana-larghezza">Larghezza Media (cm)</label><input type="number" id="collana-larghezza" value="2"></div>`;
                break;
        }
        container.innerHTML = html;
    }

    tipoProgettoSelect.addEventListener('change', aggiornaVisibilitaMisure);
    tipoProgettoPersonalizzatoSelect.addEventListener('change', aggiornaCampiMisurePersonalizzate);
    lavorazioneSelect.addEventListener('change', aggiornaPuntiDisponibili);
    campioneCheck.addEventListener('change', () => { datiCampioneDiv.classList.toggle('hidden', !campioneCheck.checked); aggiornaPreview(); });
    calcolaBtn.addEventListener('click', eseguiCalcolo);
    puntoSelect.addEventListener('change', aggiornaPreview);
    tensioneSlider.addEventListener('input', aggiornaPreview);

    // Aggiorna preview quando cambiano le misure (delegato sul container)
    document.getElementById('tool-consumo-filato-container')
        ?.addEventListener('input', e => {
            if (e.target.type === 'number') aggiornaPreview();
        });

    [blockCatalogo, blockStandard].forEach(block => {
        block.addEventListener('click', () => {
            blockCatalogo.classList.remove('active');
            blockStandard.classList.remove('active');
            block.classList.add('active');
            const radio = block.querySelector('input[type="radio"]');
            radio.checked = true;
            containerFilatoCatalogo.classList.toggle('hidden', radio.value !== 'catalogo');
            containerFilatoStandard.classList.toggle('hidden', radio.value !== 'standard');
        });
    });

    aggiornaVisibilitaMisure();

    function eseguiCalcolo() {
        risultatoDiv.style.display = 'block';
        risultatoDiv.innerHTML = '<div class="spinner-container-risultato"><div class="spinner"></div></div>';

        const inputDati = {
            tipoProgetto: tipoProgettoSelect.value,
            lavorazione:  lavorazioneSelect.value,
            puntoId:      puntoSelect.value,
            tensione:     ['larga', 'normale', 'stretta'][parseInt(tensioneSlider.value) + 1],
            campione: { peso: campioneCheck.checked ? parseFloat(document.getElementById('campione-peso')?.value) || 0 : 0 },
            misure: {}
        };

        const tipoScelta = document.querySelector('input[name="scelta-filato"]:checked').value;
        inputDati.tipoSceltaFilato = tipoScelta;

        if (tipoScelta === 'catalogo') {
            if (!filatoSelect.value) {
                risultatoDiv.innerHTML = '<p style="color:red;padding:1.5rem;">Seleziona un filato dal catalogo prima di calcolare.</p>';
                return;
            }
            inputDati.filatoId = filatoSelect.value;
        } else {
            const std = document.getElementById('standard-selezionato').value;
            if (!std) {
                risultatoDiv.innerHTML = '<p style="color:red;padding:1.5rem;">Seleziona uno standard internazionale prima di calcolare.</p>';
                return;
            }
            const [peso, metri] = std.split('-').map(Number);
            inputDati.titoloMetricoManuale = metri / peso;
            inputDati.gomitoloPesoManuale  = parseFloat(document.getElementById('gomitolo-peso-manuale').value) || 0;
        }

        const progetto = inputDati.tipoProgetto;
        if (progetto === 'maglia') {
            inputDati.misure.corpoLarghezza  = parseFloat(document.getElementById('corpo-larghezza')?.value)  || 0;
            inputDati.misure.corpoAltezza    = parseFloat(document.getElementById('corpo-altezza')?.value)    || 0;
            inputDati.misure.manicaLarghezza = parseFloat(document.getElementById('manica-larghezza')?.value) || 0;
            inputDati.misure.manicaAltezza   = parseFloat(document.getElementById('manica-altezza')?.value)   || 0;
        } else if (progetto === 'personalizzato') {
            const per = tipoProgettoPersonalizzatoSelect.value;
            if (!per) {
                risultatoDiv.innerHTML = '<p style="color:red;padding:1.5rem;">Specifica il tipo di progetto personalizzato.</p>';
                return;
            }
            inputDati.tipoProgettoPersonalizzato = per; // campo mancante — necessario per il backend
            if (per === 'borsa') {
                inputDati.misure.borsaLarghezza    = parseFloat(document.getElementById('borsa-larghezza')?.value)    || 0;
                inputDati.misure.borsaAltezza      = parseFloat(document.getElementById('borsa-altezza')?.value)      || 0;
                inputDati.misure.tracollaLunghezza = parseFloat(document.getElementById('tracolla-lunghezza')?.value) || 0;
                inputDati.misure.tracollaLarghezza = parseFloat(document.getElementById('tracolla-larghezza')?.value) || 0;
            } else if (per === 'scialle-triangolare') {
                inputDati.misure.scialleBase    = parseFloat(document.getElementById('scialle-base')?.value)    || 0;
                inputDati.misure.scialleAltezza = parseFloat(document.getElementById('scialle-altezza')?.value) || 0;
            } else if (per === 'bijoux') {
                const bij = document.getElementById('tipo-bijoux')?.value;
                if (!bij) {
                    risultatoDiv.innerHTML = '<p style="color:red;padding:1.5rem;">Seleziona il tipo di bijoux.</p>';
                    return;
                }
                inputDati.tipoBijoux = bij;
                if (bij === 'bracciale') {
                    inputDati.misure.braccialeLunghezza = parseFloat(document.getElementById('bracciale-lunghezza')?.value) || 0;
                    inputDati.misure.braccialeLarghezza = parseFloat(document.getElementById('bracciale-larghezza')?.value) || 0;
                } else if (bij === 'orecchini') {
                    inputDati.misure.orecchinoDiametro = parseFloat(document.getElementById('orecchino-diametro')?.value) || 0;
                } else if (bij === 'collana') {
                    inputDati.misure.collanaLunghezza = parseFloat(document.getElementById('collana-lunghezza')?.value) || 0;
                    inputDati.misure.collanaLarghezza = parseFloat(document.getElementById('collana-larghezza')?.value) || 0;
                }
            }
        } else {
            inputDati.misure.larghezza = parseFloat(document.getElementById('progetto-larghezza')?.value) || 0;
            inputDati.misure.altezza   = parseFloat(document.getElementById('progetto-altezza')?.value)   || 0;
        }

        fetch(URL_CALCOLO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputDati)
        })
        .then(r => r.json())
        .then(ris => {
            if (ris.error) throw new Error(ris.error);
            stato.cacheRisultatoCalcolo = ris;

            let html = `
                <h4>Scheda di Riepilogo</h4>
                <div class="risultato-sezione">
                    <p>Fabbisogno Stimato</p>
                    <div class="risultato-valore">${ris.grammiNecessari} gr</div>
                    <div class="risultato-info">circa ${ris.metriNecessari} metri</div>
                </div>`;

            if (ris.gomitoliNecessari > 0) {
                html += `<div class="risultato-sezione">
                    <p>Gomitoli da Acquistare</p>
                    <div class="risultato-valore">${ris.gomitoliNecessari}</div>
                </div>`;

                // CTA acquisto — solo filato da catalogo con link valido
                if (inputDati.tipoSceltaFilato === 'catalogo') {
                    const f = stato.dati.tuttiFilatiMap.get(inputDati.filatoId);
                    if (f?.link && f.link !== '#') {
                        const label = ris.gomitoliNecessari === 1 ? 'gomitolo' : 'gomitoli';
                        html += `<div class="cta-acquisto-wrapper">
                            <a href="${f.link}" target="_blank" rel="noopener" class="cta-acquisto">
                                🛒 Acquista ${ris.gomitoliNecessari} ${label} di ${f.nome}
                            </a>
                        </div>`;
                    }
                }
            }

            html += `<div class="cta-acquisto-wrapper">
                <button id="reset-calcolo-btn" class="calcolo-btn" style="background:var(--text-muted);">
                    ↺ Calcola un nuovo progetto
                </button>
            </div>`;

            risultatoDiv.innerHTML = html;
            document.getElementById('reset-calcolo-btn')?.addEventListener('click', () => {
                risultatoDiv.innerHTML = '';
                risultatoDiv.style.display = 'none';
                tipoProgettoSelect.value = 'maglia';
                aggiornaVisibilitaMisure();
                const fp = document.getElementById('filato-preview');
                if (fp) { fp.textContent = ''; fp.className = 'filato-preview'; }
                // Chiudi sezione avanzata
                document.getElementById('avanzate-section')?.classList.add('hidden');
                const toggle = document.getElementById('avanzate-toggle');
                if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.querySelector('.avanzate-arrow').textContent = '▼'; }
                risultatoDiv.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        })
        .catch(err => {
            console.error('Errore calcolo:', err);
            risultatoDiv.innerHTML = `<p style="color:red;padding:1.5rem;"><strong>Errore:</strong> ${err.message}.</p>`;
        });
    }

    function aggiornaListaSuggerimenti() {
        const tag   = document.getElementById('filtro-tag')?.value;
        const lista = document.getElementById('suggerimenti-lista');
        if (!lista || !stato.cacheRisultatoCalcolo.filatiConsigliati) return;
        if (!tag) { lista.innerHTML = ''; return; }

        const filtrati = stato.cacheRisultatoCalcolo.filatiConsigliati.filter(f => f.tags.includes(tag));
        lista.innerHTML = filtrati.length > 0
            ? '<ul>' + filtrati.map(f =>
                `<li><a href="${f.link || '#'}" target="_blank">${f.nome}</a><span class="efficienza">${f.efficienza}%</span></li>`
              ).join('') + '</ul>'
            : '<p style="color:var(--text-muted);">Nessun filato trovato per questo filtro.</p>';
    }

    // ============================================================
    // TOOL CALCOLO PREZZO
    // ============================================================
    const contenitorePrezzo = document.getElementById('tool-prezzo-vendita-container');
    if (contenitorePrezzo) {
        const stepsPrezzo = document.querySelectorAll('.prezzo-step');
        contenitorePrezzo.addEventListener('click', e => {
            if (e.target.matches('[data-next-step]')) { e.preventDefault(); mostraStepPrezzo(e.target.dataset.nextStep, stepsPrezzo); }
            if (e.target.matches('[data-prev-step]')) { e.preventDefault(); mostraStepPrezzo(e.target.dataset.prevStep, stepsPrezzo); }
            if (e.target.id === 'calcola-prezzo-finale-btn') { e.preventDefault(); eseguiCalcoloPrezzo(stepsPrezzo); }
            if (e.target.id === 'ricomincia-prezzo-btn')     { e.preventDefault(); resetWizardPrezzo(stepsPrezzo); }
        });
    }

    function aggiornaWizardProgress(stepAttivo) {
        const dots = document.querySelectorAll('#wizard-progress .wizard-dot');
        const lines = document.querySelectorAll('#wizard-progress .wizard-line');
        const n = parseInt(stepAttivo);
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i + 1 === n);
            dot.classList.toggle('done', i + 1 < n);
        });
        lines.forEach((line, i) => {
            line.classList.toggle('done', i + 1 < n);
        });
    }
    function mostraStepPrezzo(n, steps) {
        steps.forEach(s => s.classList.remove('active'));
        document.getElementById(`prezzo-step-${n}`)?.classList.add('active');
        aggiornaWizardProgress(n);
    }
    function resetWizardPrezzo(steps) {
        document.getElementById('costo-materiali').value = '';
        steps.forEach(s => s.classList.remove('active'));
        document.getElementById('prezzo-step-1').classList.add('active');
        aggiornaWizardProgress(1);
    }
    function eseguiCalcoloPrezzo(steps) {
        const costo      = parseFloat(document.getElementById('costo-materiali').value) || 0;
        const difficolta = document.querySelector('input[name="difficolta"]:checked')?.value  || 'facile';
        const dimensione = document.querySelector('input[name="dimensione"]:checked')?.value  || 'miniatura';
        const esperienza = document.querySelector('input[name="esperienza"]:checked')?.value  || 'inesperta';
        const margine    = document.querySelector('input[name="marginalita"]:checked')?.value || 'amatoriale';

        const cD = { facile:1.0, bassa:1.2, alta:1.6, difficile:2.0 };
        const cS = { miniatura:0.5, piccola:1.0, media:2.0, grande:4.0, over:8.0 };
        const cE = { inesperta:0.8, principiante:1.0, hobbista:1.2, esperta:1.5, professionista:2.0 };
        const cM = { amatoriale:0.20, hobbista:0.40, impegnata:0.70, professionista:1.0 };

        const lavoro  = 10 * cD[difficolta] * cS[dimensione] * cE[esperienza];
        const prezzo  = (costo + lavoro) * (1 + cM[margine]);
        const box     = document.getElementById('risultato-prezzo');

        box.innerHTML = `
            <h4>Prezzo di Vendita Stimato</h4>
            <div class="risultato-sezione">
                <p>Valore consigliato</p>
                <div class="risultato-valore">${prezzo.toFixed(2)} €</div>
            </div>
            <div class="suggerimenti-container">
                <p class="info-tool">Prezzo di riferimento basato sui parametri inseriti. Considera anche domanda locale, concorrenza e stagionalità.</p>
                <button id="ricomincia-prezzo-btn" class="calcolo-btn" style="background:var(--text-muted);margin-top:1rem;">Calcola un altro prezzo</button>
            </div>`;

        steps.forEach(s => s.classList.remove('active'));
        box.classList.add('active');
    }

    // ============================================================
    // MODALI GUIDA
    // ============================================================
    guidaTestualeBtn?.addEventListener('click', () => modaleGuidaOverlay.classList.remove('hidden'));
    modaleGuidaCloseBtn?.addEventListener('click', () => modaleGuidaOverlay.classList.add('hidden'));

    videoGuidaBtn?.addEventListener('click', () => {
        document.getElementById('modale-video-guida-body').innerHTML =
            `<iframe src="https://www.youtube.com/embed/9VOrN9S3C5Y" title="Guida Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        modaleVideoGuidaOverlay.classList.remove('hidden');
    });
    modaleVideoGuidaCloseBtn?.addEventListener('click', () => {
        document.getElementById('modale-video-guida-body').innerHTML = '';
        modaleVideoGuidaOverlay.classList.add('hidden');
    });

    refreshAppBtn?.addEventListener('click', () => location.reload(true));

});
