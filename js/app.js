document.addEventListener('DOMContentLoaded', () => {console.log("File app.js caricato e in esecuzione.");

    // --- URL DELLE FUNZIONI BACKEND ---
    const URL_TUTORIALS = "https://gettutorials-blvnz6q2ua-uc.a.run.app";
    const URL_FILATI = "https://us-central1-mtt-management-tool.cloudfunctions.net/getFilati";
    const URL_FATTORI = "https://us-central1-mtt-management-tool.cloudfunctions.net/getFattoriPunto";
    const URL_CALCOLO = "https://stimaconsumoavanzata-blvnz6q2ua-uc.a.run.app";

    // --- STATO DELL'APPLICAZIONE ---
    let statoApp = {
        dati: {
            tuttiTutorials: [],
            tuttiFilati: [],
            tuttiFilatiMap: new Map(),
            fattoriPunto: {}
        },
        filtriCatalogo: {
            termineRicerca: '',
            autrice: 'tutte',
            filato: 'tutti'
        },
        cacheRisultatoCalcolo: {}
    };

    // --- RIFERIMENTI HTML GENERALI ---
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // --- RIFERIMENTI HTML CATALOGO ---
    const contenitoreCatalogo = document.getElementById('catalogo-container');
    const searchInput = document.getElementById('search-input');
    const filtroAutriceSelect = document.getElementById('filtro-autrice');
    const filtroFilatoSelect = document.getElementById('filtro-filato');
    
    // --- RIFERIMENTI HTML TOOL CALCOLO FILATO ---
    const tipoProgettoSelect = document.getElementById('tipo-progetto');
    const campiMisureStandardContainer = document.getElementById('campi-misure-standard');
    const campiMisurePersonalizzateContainer = document.getElementById('campi-misure-personalizzate');
    const tipoProgettoPersonalizzatoSelect = document.getElementById('tipo-progetto-personalizzato');
    const campiMisurePersonalizzateDinamici = document.getElementById('campi-misure-personalizzate-dinamici');
    const filatoSelect = document.getElementById('filato-selezionato');
    const lavorazioneSelect = document.getElementById('tipo-lavorazione');
    const puntoSelect = document.getElementById('tipo-punto');
    const tensioneSlider = document.getElementById('tensione-slider');
    const campioneCheck = document.getElementById('ho-campione-check');
    const datiCampioneDiv = document.getElementById('dati-campione');
    const calcolaBtn = document.getElementById('calcola-consumo-btn');
    const risultatoDiv = document.getElementById('risultato-consumo');
    const blockCatalogo = document.getElementById('block-catalogo');
    const blockStandard = document.getElementById('block-standard');
    const containerFilatoCatalogo = document.getElementById('container-filato-catalogo');
    const containerFilatoStandard = document.getElementById('container-filato-standard');

    // --- RIFERIMENTI HTML MODALE TUTORIAL ---
    const modaleTutorialOverlay = document.getElementById('modale-tutorial-overlay');
    const modaleTutorialBody = document.getElementById('modale-tutorial-body');
    const modaleTutorialCloseBtn = document.getElementById('modale-tutorial-close');
    // NUOVO BLOCCO DA INCOLLARE
// --- RIFERIMENTI HTML GUIDA ---
const guidaTestualeBtn = document.getElementById('guida-testuale-btn');
const videoGuidaBtn = document.getElementById('video-guida-btn');
const modaleGuidaOverlay = document.getElementById('modale-guida-overlay');
const modaleGuidaCloseBtn = document.getElementById('modale-guida-close');
const modaleVideoGuidaOverlay = document.getElementById('modale-video-guida-overlay');
const modaleVideoGuidaCloseBtn = document.getElementById('modale-video-guida-close');
// --- LOGICA PULSANTE AGGIORNA ---
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Mostra uno spinner per far capire che sta caricando
            mostraSpinner(); 
            // Ricarica la pagina
            location.reload();
        });
    }
    
// ==========================================================
// FUNZIONI DI UTILITÀ (ES. SPINNER)
// ==========================================================
function mostraSpinner() {
    const spinner = document.createElement('div');
    spinner.className = 'spinner-overlay';
    spinner.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(spinner);
}

function nascondiSpinner() {
    const spinner = document.querySelector('.spinner-overlay');
    if (spinner) {
        spinner.remove();
    }
}

    // ==========================================================
    // LOGICA DI NAVIGAZIONE A SCHEDE
    // ==========================================================
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            const schedaDaMostrare = button.dataset.scheda;
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(schedaDaMostrare).classList.add('active');
        });
    });

    // ==========================================================
    // CARICAMENTO DATI INIZIALI
    // ==========================================================
    // NUOVO BLOCCO
mostraSpinner(); // Mostra lo spinner all'avvio

// URL pubblico del file JSON generato dalla tua funzione Firebase.
const URL_CACHE_TUTORIALS = 'https://storage.googleapis.com/mtt-management-tool.firebasestorage.app/cache/tutorials.json';

Promise.all([
    // Aggiunge un parametro univoco per bypassare qualsiasi cache
    fetch(`${URL_CACHE_TUTORIALS}?v=${new Date().getTime()}`).then(res => {
        if (!res.ok) { throw new Error(`Errore nel caricare la cache: ${res.statusText}`); }
        return res.json();
    }),
    fetch(URL_FILATI).then(res => res.json()),
    fetch(URL_FATTORI).then(res => res.json())
]).then(([datiTutorials, datiFilati, datiFattori]) => {
    statoApp.dati.tuttiTutorials = datiTutorials;
    statoApp.dati.tuttiFilati = datiFilati;
    statoApp.dati.tuttiFilatiMap = new Map(datiFilati.map(f => [f.nome.toLowerCase().trim(), f]));
    statoApp.dati.fattoriPunto = datiFattori;

    popolaFiltriCatalogo();
    renderAppCatalogo(); 

    popolaSelect(filatoSelect, datiFilati, "Scegli un filato");
    aggiornaPuntiDisponibili();

})
.catch(error => {
    console.error("--- ERRORE CRITICO DURANTE IL CARICAMENTO DATI ---", error);
    if(contenitoreCatalogo) contenitoreCatalogo.innerHTML = `<p style="text-align:center; color:red;">Oops! Caricamento dati fallito. Potrebbe esserci un problema con il nostro server. Riprova più tardi.</p>`;
}).finally(() => {
    nascondiSpinner();
});

    // ==========================================================
    // LOGICA CATALOGO
    // ==========================================================
    function popolaFiltriCatalogo() {
        const autrici = [...new Set(statoApp.dati.tuttiTutorials.map(t => t.autrice ? t.autrice.trim() : '').filter(Boolean))].sort();
        filtroAutriceSelect.innerHTML = '<option value="tutte">Filtra per Autrice</option>';
        autrici.forEach(a => {
            const option = document.createElement('option');
            option.value = a;
            option.textContent = a;
            filtroAutriceSelect.appendChild(option);
        });

        filtroFilatoSelect.innerHTML = '<option value="tutti">Filtra per Filato</option>';
        statoApp.dati.tuttiFilati.forEach(f => {
            const option = document.createElement('option');
            option.value = f.nome;
            option.textContent = f.nome;
            filtroFilatoSelect.appendChild(option);
        });
    }

    searchInput.addEventListener('input', (e) => {
        statoApp.filtriCatalogo.termineRicerca = e.target.value.toLowerCase();
        renderAppCatalogo();
    });
    filtroAutriceSelect.addEventListener('change', (e) => {
        statoApp.filtriCatalogo.autrice = e.target.value;
        renderAppCatalogo();
    });
    filtroFilatoSelect.addEventListener('change', (e) => {
        statoApp.filtriCatalogo.filato = e.target.value;
        renderAppCatalogo();
    });

    contenitoreCatalogo.addEventListener('click', (e) => {
        const cardCliccata = e.target.closest('.card');
        if (cardCliccata) {
            const tutorialId = cardCliccata.dataset.id;
            apriModaleTutorial(tutorialId);
        }
    });

    function renderAppCatalogo() {
        let tutorialDaMostrare = statoApp.dati.tuttiTutorials;
        const { termineRicerca, autrice, filato } = statoApp.filtriCatalogo;

        if (termineRicerca) {
            tutorialDaMostrare = tutorialDaMostrare.filter(item => 
                (item.titolo || '').toLowerCase().includes(termineRicerca) || 
                (item.autrice || '').toLowerCase().includes(termineRicerca) || 
                (item.materiali || '').toLowerCase().includes(termineRicerca)
            );
        }
        if (autrice !== 'tutte') {
            tutorialDaMostrare = tutorialDaMostrare.filter(item => (item.autrice || '').trim() === autrice);
        }
        if (filato !== 'tutti') {
            tutorialDaMostrare = tutorialDaMostrare.filter(item => (item.materiali || '').toLowerCase().includes(filato.toLowerCase()));
        }

        renderCatalogo(tutorialDaMostrare);
    }
    
    function renderCatalogo(dati) {
        let htmlDaInserire = '';
        if (dati.length === 0) {
            htmlDaInserire = `<p style="text-align:center; padding: 2rem;">Nessun tutorial trovato per i filtri selezionati.</p>`;
        } else {
            for (const item of dati) {
                const immagine = item.youtubeId ? `https://i.ytimg.com/vi/${item.youtubeId}/mqdefault.jpg` : `https://via.placeholder.com/400x225.png?text=Video+non+disponibile`;
                htmlDaInserire += `<div class="card" data-id="${item.id}">
                                      <img src="${immagine}" alt="${item.titolo}">
                                      <div class="card-content">
                                         <h3>${item.titolo || 'Titolo non disponibile'}</h3>
                                         <p>Autrice: ${item.autrice || 'N/D'}</p>
                                         <p class="materiali">Materiali: ${item.materiali || 'N/D'}</p>
                                      </div>
                                   </div>`;
            }
        }
        contenitoreCatalogo.innerHTML = htmlDaInserire;
    }

    // ==========================================================
    // LOGICA MODALE DETTAGLIO TUTORIAL
    // ==========================================================
    function apriModaleTutorial(id) {
        const tutorial = statoApp.dati.tuttiTutorials.find(t => t.id === id);
        if (!tutorial) return;

        let mostraAdattaTaglia = true;
        const tagDaEscludere = ["bijoux", "borse e accessori", "ricamo"];
        const materialiTutorial = (tutorial.materiali || "").toLowerCase();
        
        for (const filato of statoApp.dati.tuttiFilati) {
            if (materialiTutorial.includes(filato.nome.toLowerCase().trim())) {
                if (filato.tags && filato.tags.some(tag => tagDaEscludere.includes(tag.toLowerCase()))) {
                    mostraAdattaTaglia = false;
                    break; 
                }
            }
        }

        const pulsanteAdattaTagliaHtml = mostraAdattaTaglia 
            ? `<button class="tool-btn" data-tool="adatta-taglia">Adatta alla tua Taglia</button>` 
            : `<p class="info-tool"><i>L'adattamento taglia non è applicabile a questo tipo di progetto.</i></p>`;

        modaleTutorialBody.innerHTML = `
            <div class="modale-tutorial-grid">
                <div class="modale-video">
                    <iframe width="100%" height="315" src="https://www.youtube.com/embed/${tutorial.youtubeId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
                <div class="modale-dettagli">
                    <h3>${tutorial.titolo}</h3>
                    <p><strong>Autrice:</strong> ${tutorial.autrice}</p>
                    <p><strong>Materiale Originale:</strong> ${tutorial.materiali}</p>
                    <hr>
                    <div class="modale-azioni-tool">
                        <button class="tool-btn" data-tool="sostituisci-filato">Sostituisci il Filato</button>
                        ${pulsanteAdattaTagliaHtml}
                    </div>
                    <div id="tool-content-area" class="tool-content-area"></div>
                </div>
            </div>
        `;
        modaleTutorialOverlay.classList.remove('hidden');

        modaleTutorialBody.querySelectorAll('.tool-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const toolSelezionato = e.target.dataset.tool;
                if (toolSelezionato === 'sostituisci-filato') {
                    mostraToolSostituzione(tutorial);
                } else if (toolSelezionato === 'adatta-taglia') {
                    mostraToolAdattamento(tutorial);
                }
            });
        });
    }
    
    function mostraToolSostituzione(tutorial) {
        const toolContentArea = document.getElementById('tool-content-area');
        const materialiTutorial = (tutorial.materiali || "").toLowerCase();
        const filatiTrovati = statoApp.dati.tuttiFilati.filter(f => materialiTutorial.includes(f.nome.toLowerCase().trim()));
    
        if (filatiTrovati.length === 0) {
            toolContentArea.innerHTML = `<hr class="form-hr"><p style="color:red;">Non è stato possibile identificare un filato di riferimento compatibile nel nostro catalogo per questo tutorial.</p>`;
            return;
        }
    
        if (filatiTrovati.length === 1) {
            mostraFiltriAlternative(filatiTrovati[0]);
        } else {
            let bottoniHtml = filatiTrovati.map(f => `<button class="calcolo-btn" data-filato-id="${f.id}" style="margin-top: 0.5rem;">${f.nome}</button>`).join('');
            toolContentArea.innerHTML = `<hr class="form-hr"><h4>Quale di questi filati vuoi sostituire?</h4>${bottoniHtml}`;
    
            toolContentArea.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const filatoId = e.target.dataset.filatoId;
                    const filatoScelto = statoApp.dati.tuttiFilati.find(f => f.id === filatoId);
                    if (filatoScelto) {
                        mostraFiltriAlternative(filatoScelto);
                    }
                });
            });
        }
    }
    
    function mostraFiltriAlternative(filatoOriginale) {
        const toolContentArea = document.getElementById('tool-content-area');
        const tuttiTag = [...new Set(statoApp.dati.tuttiFilati.flatMap(f => f.tags || []))].sort();
        let opzioniTagHtml = '';
        tuttiTag.forEach(tag => { opzioniTagHtml += `<option value="${tag}">${tag}</option>`; });
    
        toolContentArea.innerHTML = `
            <hr class="form-hr">
            <div class="tool-wrapper">
                <h4>Alternative a <i>${filatoOriginale.nome}</i></h4>
                <div class="form-group">
                    <label for="filtro-tag-sostituzione">Filtra le alternative per tipologia</label>
                    <select id="filtro-tag-sostituzione">
                        <option value="tutti">Mostra tutte le alternative compatibili</option>
                        ${opzioniTagHtml}
                    </select>
                </div>
                <div id="risultato-sostituzione" class="risultato-box" style="text-align: left; margin-top: 1rem; display: none;"></div>
            </div>
        `;
    
        const filtroTagSelect = document.getElementById('filtro-tag-sostituzione');
        filtroTagSelect.addEventListener('change', () => mostraRisultatiSostituzione(filatoOriginale));
        mostraRisultatiSostituzione(filatoOriginale);
    }
    
    function mostraRisultatiSostituzione(filatoOriginale) {
        const tagSelezionato = document.getElementById('filtro-tag-sostituzione').value;
        const risultatoDiv = document.getElementById('risultato-sostituzione');
    
        const filatoOriginaleCompleto = statoApp.dati.tuttiFilati.find(f => f.id === filatoOriginale.id);
    
        if (!filatoOriginaleCompleto || !filatoOriginaleCompleto.titoloMetrico) {
            risultatoDiv.innerHTML = `<p style="color:red;">Dati di peso/lunghezza insufficienti per il filato originale. Aggiornalo nell'Admin Tool e riprova.</p>`;
            risultatoDiv.style.display = 'block';
            return;
        }
    
        const titoloMetricoOriginale = filatoOriginaleCompleto.titoloMetrico;
        let filatiAlternativi = statoApp.dati.tuttiFilati.filter(f => {
            if (f.id === filatoOriginaleCompleto.id || !f.titoloMetrico || f.stato !== 'Attivo') return false;
            if (tagSelezionato !== 'tutti') return f.tags && f.tags.includes(tagSelezionato);
            return true;
        });
    
        const risultati = filatiAlternativi.map(f => {
            const differenza = Math.abs(f.titoloMetrico - titoloMetricoOriginale) / titoloMetricoOriginale;
            const efficienza = Math.round((1 - differenza) * 100);
            return { ...f, efficienza };
        }).filter(f => f.efficienza >= 80).sort((a, b) => b.efficienza - a.efficienza);
    
        let htmlRisultato = '';
        if (risultati.length > 0) {
            htmlRisultato += '<ul>';
            risultati.forEach(f => {
                htmlRisultato += `<li><a href="${f.link}" target="_blank">${f.nome}</a><span class="efficienza">${f.efficienza}% compatibilità</span></li>`;
            });
            htmlRisultato += '</ul>';
        } else {
            htmlRisultato += '<p>Nessuna alternativa trovata per la tipologia selezionata.</p>';
        }
        risultatoDiv.innerHTML = htmlRisultato;
        risultatoDiv.style.display = 'block';
    }
      
    function mostraToolAdattamento(tutorial) {
        const toolContentArea = document.getElementById('tool-content-area');
        
        const taglieStandard = [40, 42, 44, 46, 48, 50, 52, 54];
        const taglieEstese = [40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60];
    
        let opzioniStandardHtml = taglieStandard.map(t => `<option value="${t}">Taglia ${t}</option>`).join('');
        let opzioniEsteseHtml = taglieEstese.map(t => `<option value="${t}">Taglia ${t}</option>`).join('');
    
        toolContentArea.innerHTML = `
            <hr class="form-hr">
            <div class="tool-wrapper">
                <h4>Adatta alla Tua Taglia</h4>
                <p class="info-tool">Inserisci i dati del progetto originale e la tua taglia per una stima del nuovo fabbisogno di filato.</p>
                <div class="form-group">
                    <label for="taglia-originale">Taglia del progetto nel video</label>
                    <select id="taglia-originale">${opzioniStandardHtml}</select>
                </div>
                <div class="form-group">
                    <label for="peso-originale-taglia">Quantità filato usata nel video (grammi)</label>
                    <input type="number" id="peso-originale-taglia" placeholder="Es: 450">
                </div>
                <div class="form-group">
                    <label for="taglia-desiderata">La tua taglia</label>
                    <select id="taglia-desiderata">${opzioniEsteseHtml}</select>
                </div>
                <button id="calcola-adattamento-btn" class="calcolo-btn">Calcola Adattamento</button>
                <div id="risultato-adattamento" class="risultato-box" style="text-align: left; margin-top: 1rem; display: none;"></div>
            </div>
        `;
    
        const calcolaBtn = document.getElementById('calcola-adattamento-btn');
        calcolaBtn.addEventListener('click', () => {
            const tagliaOriginale = parseInt(document.getElementById('taglia-originale').value);
            const pesoOriginale = parseFloat(document.getElementById('peso-originale-taglia').value);
            const tagliaDesiderata = parseInt(document.getElementById('taglia-desiderata').value);
            const risultatoDiv = document.getElementById('risultato-adattamento');
    
            if (!tagliaOriginale || !pesoOriginale || !tagliaDesiderata) {
                risultatoDiv.innerHTML = `<p style="color:red;">Per favore, compila tutti i campi.</p>`;
                risultatoDiv.style.display = 'block';
                return;
            }
    
            const nuovoPesoStimato = (pesoOriginale / tagliaOriginale) * tagliaDesiderata;
            
            const nomeFilatoOriginale = (tutorial.materiali || "").split(',')[0].trim().toLowerCase();
            const filatoOriginale = statoApp.dati.tuttiFilati.find(f => f.nome.toLowerCase().trim() === nomeFilatoOriginale);
    
            let gomitoliHtml = '';
            if (filatoOriginale && filatoOriginale.peso > 0) {
                const gomitoliNecessari = Math.ceil(nuovoPesoStimato / filatoOriginale.peso);
                gomitoliHtml = `<div class="risultato-finale">🛒 Dovrai acquistare circa <strong>${gomitoliNecessari} gomitoli</strong> di <i>${filatoOriginale.nome}</i>.</div>`;
            }
            
            risultatoDiv.innerHTML = `
                <h5>Nuova Stima per la Taglia ${tagliaDesiderata}</h5>
                <p>Per realizzare questo progetto nella tua taglia, ti serviranno circa:</p>
                <div class="risultato-valore" style="margin-bottom: 1rem;">
                    <strong>${Math.round(nuovoPesoStimato)} grammi</strong> di filato.
                </div>
                ${gomitoliHtml}
            `;
            risultatoDiv.style.display = 'block';
        });
    }

    modaleTutorialCloseBtn.addEventListener('click', () => {
        modaleTutorialOverlay.classList.add('hidden');
        modaleTutorialBody.innerHTML = '';
    });


    // ==========================================================
    // LOGICA TOOL CALCOLO FILATO
    // ==========================================================
    function popolaSelect(selectElement, dati, placeholder) {
        if (!selectElement) return;
        selectElement.innerHTML = `<option value="">-- ${placeholder} --</option>`;
        dati.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id || item.value;
            option.textContent = item.nome;
            selectElement.appendChild(option);
        });
    }

    function aggiornaPuntiDisponibili() {
        const lavorazioneScelta = lavorazioneSelect.value;
        const puntiData = statoApp.dati.fattoriPunto;
        if (puntiData && puntiData[lavorazioneScelta]) {
            const punti = Object.keys(puntiData[lavorazioneScelta]).map(key => ({ id: key, nome: puntiData[lavorazioneScelta][key].nome }));
            popolaSelect(puntoSelect, punti, "Scegli un punto");
        }
    }

    function aggiornaVisibilitaMisure() {
        const tipoSelezionato = tipoProgettoSelect.value;
        if (tipoSelezionato === 'personalizzato') {
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
    }

    function aggiornaCampiMisureStandard() {
        const tipo = tipoProgettoSelect.value;
        let htmlDaInserire = '';
        switch (tipo) {
            case 'coperta': case 'sciarpa':
                htmlDaInserire = `<h4>Inserisci le Misure</h4><div class="form-group"><label for="progetto-larghezza">Larghezza (cm)</label><input type="number" id="progetto-larghezza" placeholder="Es: 80"></div><div class="form-group"><label for="progetto-altezza">Altezza (cm)</label><input type="number" id="progetto-altezza" placeholder="Es: 120"></div>`;
                break;
            case 'maglia':
                htmlDaInserire = `<h4>Misure (pannello frontale)</h4><div class="form-group"><label for="corpo-larghezza">Larghezza Corpo (cm)</label><input type="number" id="corpo-larghezza" placeholder="Metà circonferenza"></div><div class="form-group"><label for="corpo-altezza">Altezza Corpo (cm)</label><input type="number" id="corpo-altezza" placeholder="Dalle spalle all'orlo"></div><h4>Misure (manica singola)</h4><div class="form-group"><label for="manica-larghezza">Larghezza Manica (cm)</label><input type="number" id="manica-larghezza" placeholder="Aperta e piatta"></div><div class="form-group"><label for="manica-altezza">Lunghezza Manica (cm)</label><input type="number" id="manica-altezza" placeholder="Dalla spalla al polso"></div>`;
                break;
            case 'cappello':
                 htmlDaInserire = `<h4>Inserisci le Misure</h4><div class="form-group"><label for="progetto-larghezza">Circonferenza (cm)</label><input type="number" id="progetto-larghezza" placeholder="Es: 56"></div><div class="form-group"><label for="progetto-altezza">Altezza (cm)</label><input type="number" id="progetto-altezza" placeholder="Es: 25"></div>`;
                break;
        }
        campiMisureStandardContainer.innerHTML = htmlDaInserire;
    }
    
    function aggiornaCampiMisurePersonalizzate() {
        const tipo = tipoProgettoPersonalizzatoSelect.value;
        let htmlDaInserire = '';
        switch(tipo) {
            case 'borsa':
                htmlDaInserire = `<div class="form-group"><label for="borsa-larghezza">Larghezza Borsa (cm)</label><input type="number" id="borsa-larghezza"></div><div class="form-group"><label for="borsa-altezza">Altezza Borsa (cm)</label><input type="number" id="borsa-altezza"></div><div class="form-group"><label for="tracolla-lunghezza">Lunghezza Tracolla (cm)</label><input type="number" id="tracolla-lunghezza"></div><div class="form-group"><label for="tracolla-larghezza">Larghezza Tracolla (cm)</label><input type="number" id="tracolla-larghezza"></div>`;
                break;
            case 'scialle-triangolare':
                htmlDaInserire = `<div class="form-group"><label for="scialle-base">Base Triangolo (cm)</label><input type="number" id="scialle-base"></div><div class="form-group"><label for="scialle-altezza">Altezza Triangolo (cm)</label><input type="number" id="scialle-altezza"></div>`;
                break;
            case 'bijoux':
                htmlDaInserire = `<div class="form-group"><label for="tipo-bijoux">Scegli il tipo di bijoux</label><select id="tipo-bijoux"><option value="">-- Seleziona --</option><option value="bracciale">Bracciale</option><option value="orecchini">Orecchini (la coppia)</option><option value="collana">Collana</option></select></div><div id="campi-misure-bijoux-dinamici"></div>`;
                break;
            default:
                htmlDaInserire = '';
        }
        campiMisurePersonalizzateDinamici.innerHTML = htmlDaInserire;
        const tipoBijouxSelect = document.getElementById('tipo-bijoux');
        if (tipoBijouxSelect) {
            tipoBijouxSelect.addEventListener('change', aggiornaCampiBijoux);
            aggiornaCampiBijoux();
        }
    }

    function aggiornaCampiBijoux() {
        const tipoBijouxSelect = document.getElementById('tipo-bijoux');
        if (!tipoBijouxSelect) return;
        const tipo = tipoBijouxSelect.value;
        const container = document.getElementById('campi-misure-bijoux-dinamici');
        let htmlDaInserire = '';
        switch(tipo) {
            case 'bracciale':
                htmlDaInserire = `<div class="form-group"><label for="bracciale-lunghezza">Circonferenza Polso (cm)</label><input type="number" id="bracciale-lunghezza"></div><div class="form-group"><label for="bracciale-larghezza">Larghezza Fascia (cm)</label><input type="number" id="bracciale-larghezza"></div>`;
                break;
            case 'orecchini':
                htmlDaInserire = `<div class="form-group"><label for="orecchino-diametro">Diametro di 1 orecchino (cm)</label><input type="number" id="orecchino-diametro"></div>`;
                break;
            case 'collana':
                htmlDaInserire = `<div class="form-group"><label for="collana-lunghezza">Lunghezza Collana (cm)</label><input type="number" id="collana-lunghezza"></div><div class="form-group"><label for="collana-larghezza">Larghezza Media (cm)</label><input type="number" id="collana-larghezza" value="2"></div>`;
                break;
        }
        container.innerHTML = htmlDaInserire;
    }
    
    tipoProgettoSelect.addEventListener('change', aggiornaVisibilitaMisure);
    tipoProgettoPersonalizzatoSelect.addEventListener('change', aggiornaCampiMisurePersonalizzate);
    lavorazioneSelect.addEventListener('change', aggiornaPuntiDisponibili);
    campioneCheck.addEventListener('change', () => datiCampioneDiv.classList.toggle('hidden', !campioneCheck.checked));
    calcolaBtn.addEventListener('click', eseguiCalcolo);
    
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
    
// NUOVO BLOCCO
function eseguiCalcolo() {
    risultatoDiv.style.display = 'block';
    risultatoDiv.innerHTML = '<div class="spinner-container-risultato"><div class="spinner"></div></div>'; // Spinner nel box

    // ... (tutta la logica di raccolta dati resta identica) ...
    const inputDati = {
        tipoProgetto: tipoProgettoSelect.value,
        lavorazione: lavorazioneSelect.value,
        puntoId: puntoSelect.value,
        tensione: ['larga', 'normale', 'stretta'][parseInt(tensioneSlider.value) + 1],
        campione: { peso: campioneCheck.checked ? parseFloat(document.getElementById('campione-peso')?.value) || 0 : 0 },
        misure: {}
    };
    const tipoSceltaFilato = document.querySelector('input[name="scelta-filato"]:checked').value;
    inputDati.tipoSceltaFilato = tipoSceltaFilato;
    if (tipoSceltaFilato === 'catalogo') {
        inputDati.filatoId = filatoSelect.value;
    } else {
        const standardSelect = document.getElementById('standard-selezionato');
        const gomitoloPesoInput = document.getElementById('gomitolo-peso-manuale');
        const standardValue = standardSelect.value;
        if (standardValue) {
            const [peso, metri] = standardValue.split('-').map(Number);
            inputDati.titoloMetricoManuale = metri / peso;
        }
        inputDati.gomitoloPesoManuale = parseFloat(gomitoloPesoInput.value) || 0;
    }
    const progetto = inputDati.tipoProgetto;
    if (progetto === 'maglia') {
        inputDati.misure.corpoLarghezza = parseFloat(document.getElementById('corpo-larghezza')?.value) || 0;
        inputDati.misure.corpoAltezza = parseFloat(document.getElementById('corpo-altezza')?.value) || 0;
        inputDati.misure.manicaLarghezza = parseFloat(document.getElementById('manica-larghezza')?.value) || 0;
        inputDati.misure.manicaAltezza = parseFloat(document.getElementById('manica-altezza')?.value) || 0;
    } else if (progetto === 'personalizzato') {
        const personalizzato = inputDati.tipoProgettoPersonalizzato;
        if (personalizzato === 'borsa') {
            inputDati.misure.borsaLarghezza = parseFloat(document.getElementById('borsa-larghezza')?.value) || 0;
            inputDati.misure.borsaAltezza = parseFloat(document.getElementById('borsa-altezza')?.value) || 0;
            inputDati.misure.tracollaLunghezza = parseFloat(document.getElementById('tracolla-lunghezza')?.value) || 0;
            inputDati.misure.tracollaLarghezza = parseFloat(document.getElementById('tracolla-larghezza')?.value) || 0;
        } else if (personalizzato === 'scialle-triangolare') {
            inputDati.misure.scialleBase = parseFloat(document.getElementById('scialle-base')?.value) || 0;
            inputDati.misure.scialleAltezza = parseFloat(document.getElementById('scialle-altezza')?.value) || 0;
        } else if (personalizzato === 'bijoux') {
            const bijoux = inputDati.tipoBijoux;
            if(bijoux === 'bracciale') {
                inputDati.misure.braccialeLunghezza = parseFloat(document.getElementById('bracciale-lunghezza')?.value) || 0;
                inputDati.misure.braccialeLarghezza = parseFloat(document.getElementById('bracciale-larghezza')?.value) || 0;
            } else if(bijoux === 'orecchini') {
                inputDati.misure.orecchinoDiametro = parseFloat(document.getElementById('orecchino-diametro')?.value) || 0;
            } else if(bijoux === 'collana') {
                inputDati.misure.collanaLunghezza = parseFloat(document.getElementById('collana-lunghezza')?.value) || 0;
                inputDati.misure.collanaLarghezza = parseFloat(document.getElementById('collana-larghezza')?.value) || 0;
            }
        }
    } else {
        inputDati.misure.larghezza = parseFloat(document.getElementById('progetto-larghezza')?.value) || 0;
        inputDati.misure.altezza = parseFloat(document.getElementById('progetto-altezza')?.value) || 0;
    }

    fetch(URL_CALCOLO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputDati)
    })
    .then(response => response.json())
    .then(risultato => {
        if (risultato.error) { throw new Error(risultato.error); }

        statoApp.cacheRisultatoCalcolo = risultato;

        // NUOVA GRAFICA PER I RISULTATI
        let htmlRisultato = `
            <h4>Scheda di Riepilogo</h4>
            <div class="risultato-sezione">
                <p>Fabbisogno Stimato</p>
                <div class="risultato-valore">${risultato.grammiNecessari} gr</div>
                <div class="risultato-info">(~${risultato.metriNecessari} metri)</div>
            </div>`;

        if (risultato.gomitoliNecessari > 0) {
             htmlRisultato += `<div class="risultato-sezione">
                                  <p>Gomitoli da Acquistare</p>
                                  <div class="risultato-valore">${risultato.gomitoliNecessari} 🛒</div>
                               </div>`;
        }

        if (risultato.filatiConsigliati && risultato.filatiConsigliati.length > 0) {
            const tuttiTag = [...new Set(risultato.filatiConsigliati.flatMap(f => f.tags))];
            htmlRisultato += `<div class="suggerimenti-container"><h4>Filati e Alternative Consigliate</h4>`;
            if (tuttiTag.length > 0) {
              htmlRisultato += `<div class="suggerimenti-filtro"><label for="filtro-tag">Filtra per Tipologia:</label><select id="filtro-tag"><option value="">-- Scegli la tipologia --</option>`;
              tuttiTag.forEach(tag => { htmlRisultato += `<option value="${tag}">${tag}</option>`; });
              htmlRisultato += `</select></div>`;
            }
            htmlRisultato += `<div id="suggerimenti-lista" class="suggerimenti-lista"></div></div>`;
        }

        risultatoDiv.innerHTML = htmlRisultato;
        const filtroTagSelect = document.getElementById('filtro-tag');
        if (filtroTagSelect) {
            filtroTagSelect.addEventListener('change', aggiornaListaSuggerimenti);
        }
    })
    .catch(error => {
        console.error("Errore nel calcolo:", error);
        risultatoDiv.innerHTML = `<p style="color:red;"><strong>Errore:</strong> ${error.message}. Assicurati di aver compilato tutti i campi correttamente.</p>`;
    });
}

    function aggiornaListaSuggerimenti() {
        const filtroTagSelect = document.getElementById('filtro-tag');
        const listaSuggerimentiDiv = document.getElementById('suggerimenti-lista');
        if (!filtroTagSelect || !listaSuggerimentiDiv || !statoApp.cacheRisultatoCalcolo.filatiConsigliati) return;
        const tagSelezionato = filtroTagSelect.value;
        if (!tagSelezionato) {
            listaSuggerimentiDiv.innerHTML = '';
            return;
        }
        const filatiFiltrati = statoApp.cacheRisultatoCalcolo.filatiConsigliati.filter(f => f.tags.includes(tagSelezionato));
        let listaHtml = '<ul>';
        filatiFiltrati.forEach(filato => {
            listaHtml += `<li><a href="${filato.link || '#'}" target="_blank">${filato.nome}</a> <span class="efficienza">${filato.efficienza}% compatibilità</span></li>`;
        });
        listaHtml += '</ul>';
        listaSuggerimentiDiv.innerHTML = filatiFiltrati.length > 0 ? listaHtml : '<p>Nessun filato trovato per questo filtro.</p>';
    }
    // NUOVO BLOCCO DA INCOLLARE
// ==========================================================
// ==========================================================
// LOGICA TOOL CALCOLO PREZZO
// ==========================================================
const contenitorePrezzo = document.getElementById('tool-prezzo-vendita-container');
if (contenitorePrezzo) {
    const tuttiStepPrezzo = document.querySelectorAll('.prezzo-step');
    
    // Gestione click sui pulsanti
    contenitorePrezzo.addEventListener('click', (e) => {
        // Pulsante "Avanti"
        if (e.target.matches('[data-next-step]')) {
            e.preventDefault();
            const passoSuccessivo = e.target.dataset.nextStep;
            mostraStepPrezzo(passoSuccessivo, tuttiStepPrezzo);
        }
        
        // Pulsante "Calcola Prezzo Finale"
        if (e.target.id === 'calcola-prezzo-finale-btn') {
            e.preventDefault();
            eseguiCalcoloPrezzo(tuttiStepPrezzo);
        }
        
        // Pulsante "Ricomincia"
        if (e.target.id === 'ricomincia-prezzo-btn') {
            e.preventDefault();
            resetWizardPrezzo(tuttiStepPrezzo);
        }
    });
}

function mostraStepPrezzo(numeroStep, tuttiGliStep) {
    tuttiGliStep.forEach(step => {
        step.classList.remove('active');
    });
    const stepAttivo = document.getElementById(`prezzo-step-${numeroStep}`);
    if (stepAttivo) {
        stepAttivo.classList.add('active');
    }
}

function resetWizardPrezzo(tuttiGliStep) {
    // Reset tutti i valori
    document.getElementById('costo-materiali').value = '';
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        if (radio.name && radio.value === radio.closest('.radio-button-group-vertical')?.querySelector('input[type="radio"]')?.value) {
            radio.checked = true;
        }
    });
    
    // Torna al primo step
    tuttiGliStep.forEach(step => step.classList.remove('active'));
    document.getElementById('prezzo-step-1').classList.add('active');
}

function eseguiCalcoloPrezzo(tuttiGliStep) {
    // Recupera i valori
    const costoMateriali = parseFloat(document.getElementById('costo-materiali').value) || 0;
    const difficolta = document.querySelector('input[name="difficolta"]:checked')?.value || 'facile';
    const dimensione = document.querySelector('input[name="dimensione"]:checked')?.value || 'miniatura';
    const esperienza = document.querySelector('input[name="esperienza"]:checked')?.value || 'inesperta';
    const marginalita = document.querySelector('input[name="marginalita"]:checked')?.value || 'amatoriale';
    
    // Coefficienti
    const coeffDifficolta = { facile: 1.0, bassa: 1.2, alta: 1.6, difficile: 2.0 };
    const coeffDimensione = { miniatura: 0.5, piccola: 1.0, media: 2.0, grande: 4.0, over: 8.0 };
    const coeffEsperienza = { inesperta: 0.8, principiante: 1.0, hobbista: 1.2, esperta: 1.5, professionista: 2.0 };
    const coeffMarginalita = { amatoriale: 0.20, hobbista: 0.40, impegnata: 0.70, professionista: 1.0 };
    const VALORE_BASE_LAVORO = 10;
    
    // Calcolo
    const valoreLavoro = VALORE_BASE_LAVORO * coeffDifficolta[difficolta] * coeffDimensione[dimensione] * coeffEsperienza[esperienza];
    const prezzoBase = costoMateriali + valoreLavoro;
    const prezzoFinale = prezzoBase * (1 + coeffMarginalita[marginalita]);
    
    // Mostra risultato
    const risultatoDivPrezzo = document.getElementById('risultato-prezzo');
    risultatoDivPrezzo.innerHTML = `
        <h4>Prezzo di Vendita Stimato</h4>
        <div class="risultato-sezione">
            <p>Il valore consigliato per la tua creazione è:</p>
            <div class="risultato-valore">${prezzoFinale.toFixed(2)} €</div>
        </div>
        <div class="suggerimenti-container">
            <p class="info-tool" style="font-size: 0.9rem;">
                * Questo è un prezzo di riferimento basato sui parametri inseriti. 
                Considera anche fattori locali come domanda, concorrenza e stagionalità.
            </p>
            <button id="ricomincia-prezzo-btn" class="calcolo-btn" style="background: #6c757d; margin-top: 1rem;">
                Calcola un altro prezzo
            </button>
        </div>
    `;
    
    // Nascondi tutti gli step e mostra il risultato
    tuttiGliStep.forEach(step => step.classList.remove('active'));
    risultatoDivPrezzo.classList.add('active');
}
// NUOVO BLOCCO DA INCOLLARE
// ==========================================================
// LOGICA MODALI GUIDA
// ==========================================================
if (guidaTestualeBtn) {
    guidaTestualeBtn.addEventListener('click', () => {
        modaleGuidaOverlay.classList.remove('hidden');
    });
}
if (modaleGuidaCloseBtn) {
    modaleGuidaCloseBtn.addEventListener('click', () => {
        modaleGuidaOverlay.classList.add('hidden');
    });
}
if (videoGuidaBtn) {
    videoGuidaBtn.addEventListener('click', () => {
        const videoBody = document.getElementById('modale-video-guida-body');
        // Incolla qui il tuo ID video di YouTube
        const videoId = '9z-5qeVKEyQ'; // Esempio
        videoBody.innerHTML = `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        modaleVideoGuidaOverlay.classList.remove('hidden');
    });
}
if (modaleVideoGuidaCloseBtn) {
    modaleVideoGuidaCloseBtn.addEventListener('click', () => {
        document.getElementById('modale-video-guida-body').innerHTML = ''; // Ferma il video
        modaleVideoGuidaOverlay.classList.add('hidden');
    });
}
});