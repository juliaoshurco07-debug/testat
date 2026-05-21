// ========== CONFIGURARE PDF.js ==========
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

// ========== INDEXEDDB ==========
let db = null;
const DB_NAME = 'AntiquaLibrisDB';
const DB_VERSION = 2;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('users')) d.createObjectStore('users', { keyPath: 'name' });
            if (!d.objectStoreNames.contains('books')) {
                const s = d.createObjectStore('books', { keyPath: 'id' });
                s.createIndex('userId', 'userId', { unique: false });
            }
        };
        req.onsuccess = e => { db = e.target.result; console.log('✅ DB deschisă'); resolve(db); };
        req.onerror = e => { console.error('❌ DB:', e.target.error); reject(e.target.error); };
    });
}

async function saveUsers() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('users', 'readwrite');
        const store = tx.objectStore('users');
        store.clear();
        users.forEach(u => store.put({ name: u.name, password: u.password, genres: u.genres || [] }));
        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
    });
}

async function loadUsers() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('users', 'readonly');
        const req = tx.objectStore('users').getAll();
        req.onsuccess = () => { users = req.result.map(u => ({ ...u })); resolve(); };
        req.onerror = e => reject(e.target.error);
    });
}

async function saveBook(book) {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    store.put({ id: book.id, userId: currentUser.name, title: book.title, author: book.author, genre: book.genre, year: book.year, status: book.status, progress: book.progress || 0, fav: book.fav || false, pdfData: book.pdfData || null });
    return new Promise(r => { tx.oncomplete = r; });
}

async function loadBooks() {
    return new Promise((resolve) => {
        if (!currentUser) { books = []; resolve([]); return; }
        const tx = db.transaction('books', 'readonly');
        const req = tx.objectStore('books').index('userId').getAll(currentUser.name);
        req.onsuccess = () => {
            books = req.result.map(b => ({ ...b, pdfData: b.pdfData ? new Uint8Array(b.pdfData) : null }));
            resolve(books);
        };
        req.onerror = () => { books = []; resolve([]); };
    });
}

async function deleteBookDB(id) {
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').delete(id);
    return new Promise(r => { tx.oncomplete = r; });
}

// ========== DATE ==========
let users = [], currentUser = null, books = [], currentFilter = 'all', currentSort = 'default';
let deleteId = null, pdfDoc = null, currentSpread = 0, totalSpreads = 0, currentBook = null, lang = 'ro';

// ========== HELPERS ==========
function q(id) { return document.getElementById(id); }
function showToast(msg, err) { 
    const t = q('toast'); 
    if (!t) return; 
    t.textContent = msg; 
    t.style.background = err ? '#c47a5a' : '#8b5a2b'; 
    t.style.opacity = '1'; 
    t.style.display = 'block'; 
    setTimeout(() => { t.style.opacity = '0'; }, 2000); 
}
function getEmoji(g) { 
    const m = { 'Roman':'📖','Poezie':'🎭','SF & Fantasy':'🚀','Istorie':'🏛️','Thriller':'🔪','Filozofie':'💭','Biografie':'👤','Altele':'📚' }; 
    return m[g] || '📚'; 
}

// ========== PAGINI ==========
function showPage(page) {
    console.log('showPage:', page);
    ['pageHome','pageBooks','pageStats','pageAbout'].forEach(id => { const el = q(id); if(el) el.style.display='none'; });
    const map = { home:'pageHome', books:'pageBooks', stats:'pageStats', about:'pageAbout' };
    const el = q(map[page]); if(el) el.style.display='block';
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`[data-page="${page}"]`); if(link) link.classList.add('active');
    if(page==='books' && currentUser) renderBooks();
    if(page==='stats' && currentUser) renderStats();
}

// ========== THEME ==========
function toggleTheme() { 
    document.body.classList.toggle('dark'); 
    const b=q('themeBtn'); 
    if(b) b.textContent=document.body.classList.contains('dark')?'☀️':'🌙'; 
    localStorage.setItem('theme',document.body.classList.contains('dark')?'dark':'light'); 
}

// ========== AUTH ==========
function openModal(id) { const el=q(id); if(el) el.style.display='flex'; }
function closeModal(id) { const el=q(id); if(el) el.style.display='none'; }

async function register() {
    console.log('register called');
    const name=q('regName')?.value.trim(), pass=q('regPass')?.value;
    if(!name||!pass){showToast('❌ Completează toate câmpurile',true);return;}
    if(users.find(u=>u.name===name)){showToast('❌ Numele există',true);return;}
    const genres=[]; document.querySelectorAll('#registerModal input[type=checkbox]:checked').forEach(cb=>genres.push(cb.value));
    users.push({name,password:pass,genres});
    await saveUsers();
    currentUser={name,password:pass,genres}; books=[]; localStorage.setItem('lastUser',name);
    q('authBox').style.display='none'; q('userBox').style.display='flex'; q('userName').textContent=name;
    closeModal('registerModal'); showToast('✅ Cont creat!'); showPage('books');
}

async function login() {
    console.log('login called');
    const name=q('loginName')?.value.trim(), pass=q('loginPass')?.value;
    if(!name||!pass){showToast('❌ Completează',true);return;}
    const u=users.find(u=>u.name===name);
    if(!u){showToast('❌ Negăsit',true);return;}
    if(u.password!==pass){showToast('❌ Parolă greșită',true);return;}
    currentUser=u; await loadBooks(); localStorage.setItem('lastUser',name);
    q('authBox').style.display='none'; q('userBox').style.display='flex'; q('userName').textContent=name;
    closeModal('loginModal'); showToast('👋 Bine ai venit!'); showPage('books');
}

function logout() { 
    currentUser=null; books=[]; localStorage.removeItem('lastUser'); 
    q('authBox').style.display='flex'; q('userBox').style.display='none'; 
    showPage('home'); showToast('👋 Deconectat!'); 
}

// ========== CĂRȚI ==========
function toggleAddForm() { 
    const f=q('addForm'); 
    if(f) f.style.display=f.style.display==='none'?'block':'none'; 
}

async function addBook() {
    if(!currentUser){showToast('❌ Conectează-te!',true);return;}
    const title=q('titleInp')?.value.trim(), author=q('authorInp')?.value.trim(), year=q('yearInp')?.value.trim()||'', genre=q('genreInp')?.value||'Altele', pdfFile=q('pdfInp')?.files[0];
    if(!title||!author){showToast('❌ Titlu și autor obligatorii!',true);return;}
    if(books.some(b=>b.title.toLowerCase()===title.toLowerCase()&&b.author.toLowerCase()===author.toLowerCase())){showToast('⚠️ Cartea există!',true);return;}
    
    const add=async(pdfData)=>{
        const nb={id:Date.now(),title,author,genre,year,pdfData:pdfData||null,status:'unread',progress:0,fav:false};
        books.push(nb); await saveBook(nb); renderBooks();
        ['titleInp','authorInp','yearInp','pdfInp'].forEach(id=>{const el=q(id);if(el)el.value='';});
        q('addForm').style.display='none'; showToast('📚 "'+title+'" adăugată!');
    };
    
    if(pdfFile){const r=new FileReader(); r.onload=e=>add(Array.from(new Uint8Array(e.target.result))); r.readAsArrayBuffer(pdfFile);}
    else add(null);
}

function renderBooks() {
    const grid=q('booksGrid'); if(!grid) return;
    let list=[...books];
    if(currentFilter==='read') list=list.filter(b=>b.status==='read');
    if(currentFilter==='unread') list=list.filter(b=>b.status==='unread');
    if(currentFilter==='favorite') list=list.filter(b=>b.fav);
    if(currentSort==='title-asc') list.sort((a,b)=>a.title.localeCompare(b.title));
    if(currentSort==='author-asc') list.sort((a,b)=>a.author.localeCompare(b.author));
    
    if(list.length===0){grid.innerHTML='<div class="empty"><div style="font-size:3rem;">📭</div><p>Nu ai cărți aici</p><button onclick="toggleAddForm()" class="btn-main" style="margin-top:10px;">+ Adaugă carte</button></div>';return;}
    
    grid.innerHTML=list.map(b=>`
        <div class="book-card">
            <div class="book-top"><span style="font-size:1.5rem;">${getEmoji(b.genre)}</span><span onclick="toggleFav(${b.id})" style="cursor:pointer;font-size:1.2rem;">${b.fav?'⭐':'☆'}</span></div>
            <h4>${b.title} ${b.year?'<small>('+b.year+')</small>':''}</h4>
            <p style="color:var(--text3);font-size:0.85rem;">${b.author}</p>
            <span class="tag">${b.genre}</span> ${b.pdfData?'<span style="color:#28a745;font-size:0.7rem;">📎 PDF</span>':''}
            ${b.progress>0&&b.progress<100?`<p style="font-size:0.8rem;color:var(--accent);">📖 ${b.progress}%</p>`:''}
            <span class="${b.status==='read'?'tag-green':'tag-yellow'}">${b.status==='read'?'✓ Citită':'○ Necitită'}</span>
            <div class="book-btns"><button onclick="readBook(${b.id})" class="btn-card">📖</button><button onclick="toggleStatus(${b.id})" class="btn-card">${b.status==='read'?'🔄':'✅'}</button><button onclick="askDelete(${b.id})" class="btn-card" style="color:#c47a5a;">🗑️</button></div>
        </div>`).join('');
}

function setFilter(f){currentFilter=f;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));const btn=document.querySelector(`[data-filter="${f}"]`);if(btn)btn.classList.add('active');renderBooks();}
async function toggleFav(id){const b=books.find(b=>b.id===id);if(b){b.fav=!b.fav;await saveBook(b);renderBooks();}}
async function toggleStatus(id){const b=books.find(b=>b.id===id);if(b){b.status=b.status==='read'?'unread':'read';if(b.status==='read')b.progress=100;await saveBook(b);renderBooks();}}
function askDelete(id){deleteId=id;const b=books.find(b=>b.id===id);if(b&&q('deleteMsg'))q('deleteMsg').textContent=`Ștergi "${b.title}"?`;openModal('deleteModal');}
async function confirmDelete(){if(deleteId){books=books.filter(b=>b.id!==deleteId);await deleteBookDB(deleteId);deleteId=null;closeModal('deleteModal');renderBooks();showToast('🗑️ Șters!');}}

// ========== STATISTICI ==========
function renderStats(){
    if(!currentUser)return;
    const t=books.length, r=books.filter(b=>b.status==='read').length, u=t-r, f=books.filter(b=>b.fav).length, rate=t?Math.round((r/t)*100):0;
    const set=(id,v)=>{const el=q(id);if(el)el.textContent=v;};
    set('sTotal',t);set('sRead',r);set('sUnread',u);set('sFav',f);set('sRate',rate+'%');
    const genres={}; books.forEach(b=>{const g=b.genre||'Altele';genres[g]=(genres[g]||0)+1;});
    const max=Math.max(...Object.values(genres),1);
    const chart=q('genreChart');
    if(chart) chart.innerHTML='<h3>📊 Distribuție pe genuri</h3>'+(Object.keys(genres).length===0?'<p>Adaugă cărți</p>':Object.entries(genres).map(([g,c])=>`<div style="display:flex;align-items:center;gap:10px;margin:8px 0;"><span style="width:120px;">${getEmoji(g)} ${g}</span><div style="flex:1;height:18px;background:var(--border);border-radius:9px;"><div style="width:${Math.round(c/max*100)}%;height:100%;background:var(--accent);border-radius:9px;"></div></div><span>${c}</span></div>`).join(''));
}

// ========== LECTURĂ ==========
async function readBook(id){
    const b=books.find(b=>b.id===id); if(!b)return;
    currentBook=b; q('readingTitle').textContent=`${b.title} - ${b.author}`; openModal('readingModal');
    if(b.pdfData){try{pdfDoc=await pdfjsLib.getDocument({data:b.pdfData}).promise;totalSpreads=Math.ceil(pdfDoc.numPages/2);currentSpread=0;await renderSpread();}catch(e){showToast('❌ Eroare PDF',true);}}
    else{const c=q('leftCanvas');if(c){c.width=500;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='#fff8ed';ctx.fillRect(0,0,500,600);ctx.fillStyle='#3e2a1f';ctx.font='16px serif';ctx.fillText(b.title,20,50);ctx.fillText('Adaugă PDF pentru a citi',20,80);}q('pageInfo').textContent='Text';}
}
async function renderSpread(){if(!pdfDoc)return;const left=currentSpread*2+1,right=left+1;if(left<=pdfDoc.numPages){const p=await pdfDoc.getPage(left);const v=p.getViewport({scale:1.2});q('leftCanvas').width=v.width;q('leftCanvas').height=v.height;await p.render({canvasContext:q('leftCanvas').getContext('2d'),viewport:v}).promise;}if(right<=pdfDoc.numPages){const p=await pdfDoc.getPage(right);const v=p.getViewport({scale:1.2});q('rightCanvas').width=v.width;q('rightCanvas').height=v.height;await p.render({canvasContext:q('rightCanvas').getContext('2d'),viewport:v}).promise;}const pct=Math.min(100,Math.round((left/pdfDoc.numPages)*100));q('progFill').style.width=pct+'%';q('progPct').textContent=pct+'%';q('pageInfo').textContent=`Pagina ${left} / ${pdfDoc.numPages}`;}
async function nextPage(){if(pdfDoc&&currentSpread+1<totalSpreads){currentSpread++;await renderSpread();}}
async function prevPage(){if(pdfDoc&&currentSpread>0){currentSpread--;await renderSpread();}}
async function saveProgress(){if(currentBook&&pdfDoc){currentBook.progress=Math.min(100,Math.round(((currentSpread*2+1)/pdfDoc.numPages)*100));await saveBook(currentBook);showToast('💾 Salvat!');}}
async function markDone(){if(currentBook){currentBook.status='read';currentBook.progress=100;await saveBook(currentBook);renderBooks();showToast('✅ Terminată!');}}
function closeReading(){closeModal('readingModal');pdfDoc=null;currentBook=null;}

// ========== CĂUTARE ==========
function searchBooks(){const t=q('searchInput')?.value.toLowerCase().trim();if(!t){renderBooks();return;}const r=books.filter(b=>b.title.toLowerCase().includes(t)||b.author.toLowerCase().includes(t));const g=q('booksGrid');if(g)g.innerHTML=r.length?r.map(b=>`<div class="book-card"><h4>${b.title}</h4><p>${b.author}</p></div>`).join(''):'<div class="empty">🔍 Niciun rezultat</div>';}

// ========== EXPORT/IMPORT ==========
function exportBooks(){if(!books.length){showToast('Nu ai cărți',true);return;}const d=books.map(b=>({title:b.title,author:b.author,genre:b.genre,year:b.year,status:b.status}));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));a.download='biblioteca.json';a.click();showToast('📤 Exportat!');}
async function importBooks(file){if(!file||!currentUser)return;const r=new FileReader();r.onload=async e=>{try{const d=JSON.parse(e.target.result);let added=0;for(const b of d){if(b.title&&b.author&&!books.some(x=>x.title===b.title&&x.author===b.author)){const nb={id:Date.now()+Math.random(),title:b.title,author:b.author,genre:b.genre||'Altele',year:b.year||'',status:b.status||'unread',progress:0,fav:false,pdfData:null};books.push(nb);await saveBook(nb);added++;}}renderBooks();showToast(`📥 ${added} importate!`);}catch(err){showToast('Eroare import',true);}};r.readAsText(file);}

// ========== CHATBOT ==========
function toggleChat(){
    const win=q('chatWindow'), btn=q('chatToggleBtn');
    if(!win)return;
    if(win.style.display==='none'||win.style.display===''){win.style.display='flex';if(btn)btn.style.display='none';
        const msgs=q('chatMessages');if(msgs&&msgs.children.length===0){setTimeout(()=>{addChatMsg('👋 Bună! Sunt asistentul. Cu ce te pot ajuta?','bot');},200);}
    }else{win.style.display='none';if(btn)btn.style.display='flex';}
}

function sendMsg(){
    const inp=q('chatInput');if(!inp)return;const msg=inp.value.trim();if(!msg)return;
    addChatMsg(msg,'user');inp.value='';
    const msgs=q('chatMessages');const typing=document.createElement('div');typing.className='msg bot';typing.id='typing';typing.textContent='...';msgs.appendChild(typing);msgs.scrollTop=msgs.scrollHeight;
    setTimeout(()=>{const t=q('typing');if(t)t.remove();addChatMsg(getBotReply(msg),'bot');},600);
}

function sendQuickMsg(msg){addChatMsg(msg,'user');const msgs=q('chatMessages');const typing=document.createElement('div');typing.className='msg bot';typing.id='typing';typing.textContent='...';msgs.appendChild(typing);msgs.scrollTop=msgs.scrollHeight;setTimeout(()=>{const t=q('typing');if(t)t.remove();addChatMsg(getBotReply(msg),'bot');},500);}

function addChatMsg(text,type){const msgs=q('chatMessages');if(!msgs)return;const d=document.createElement('div');d.className='msg '+type;const time=new Date().toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'});d.innerHTML=text.replace(/\n/g,'<br>')+'<div style="font-size:0.6rem;opacity:0.6;margin-top:3px;text-align:right;">'+time+'</div>';msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;}

function getBotReply(msg){
    const m=msg.toLowerCase();
    if(m.includes('salut')||m.includes('bună'))return '👋 Bună! Ce dorești să știi?';
    if(m.includes('adaug'))return '📚 Apasă butonul "+ Adaugă carte" din Biblioteca mea.';
    if(m.includes('citesc'))return '📖 Adaugă o carte cu PDF, apoi apasă butonul 📖.';
    if(m.includes('statistic'))return '📊 Mergi la secțiunea Statistici din meniu.';
    return 'Încearcă: "adaug", "citesc", "statistici" sau "ajutor".';
}

// ========== INIT ==========
async function init(){
    console.log('🚀 Start initializare...');
    
    // Verifică dacă elementele există
    console.log('Elemente găsite:', {
        registerBtn: !!document.getElementById('registerBtn'),
        loginBtn: !!document.getElementById('loginBtn'),
        themeBtn: !!document.getElementById('themeBtn'),
        cookieBtn: !!document.getElementById('acceptCookiesBtn')
    });
    
    try{
        await openDB();
        await loadUsers();
        console.log('✅ DB și users încărcate, users:', users.length);
    } catch(e){ console.error('Eroare DB:', e); }
    
    if(localStorage.getItem('theme')==='dark'){
        document.body.classList.add('dark');
        const b=q('themeBtn');
        if(b) b.textContent='☀️';
    }
    
    const last = localStorage.getItem('lastUser');
    if(last && users.length){
        const u = users.find(u=>u.name===last);
        if(u){
            currentUser = u;
            await loadBooks();
            const authBox = q('authBox');
            const userBox = q('userBox');
            const userName = q('userName');
            if(authBox) authBox.style.display = 'none';
            if(userBox) userBox.style.display = 'flex';
            if(userName) userName.textContent = u.name;
            console.log('✅ Utilizator încărcat:', u.name);
        }
    }
    
    if(localStorage.getItem('cookies')==='ok'){
        const cb = q('cookieBox');
        if(cb) cb.style.display = 'none';
    }
    
    // ATAȘEAZĂ TOATE EVENTURILE
    const themeBtn = q('themeBtn');
    if(themeBtn) themeBtn.addEventListener('click', toggleTheme);
    
    const registerBtn = q('registerBtn');
    if(registerBtn) registerBtn.addEventListener('click', () => openModal('registerModal'));
    
    const loginBtn = q('loginBtn');
    if(loginBtn) loginBtn.addEventListener('click', () => openModal('loginModal'));
    
    const logoutBtn = q('logoutBtn');
    if(logoutBtn) logoutBtn.addEventListener('click', logout);
    
    const closeReg = q('closeRegModal');
    if(closeReg) closeReg.addEventListener('click', () => closeModal('registerModal'));
    
    const closeLog = q('closeLogModal');
    if(closeLog) closeLog.addEventListener('click', () => closeModal('loginModal'));
    
    const closeDel = q('closeDelModal');
    if(closeDel) closeDel.addEventListener('click', () => closeModal('deleteModal'));
    
    const cancelDel = q('cancelDelBtn');
    if(cancelDel) cancelDel.addEventListener('click', () => closeModal('deleteModal'));
    
    const closeRead = q('closeReadBtn');
    if(closeRead) closeRead.addEventListener('click', closeReading);
    
    const confirmReg = q('confirmRegBtn');
    if(confirmReg) confirmReg.addEventListener('click', register);
    
    const confirmLog = q('confirmLogBtn');
    if(confirmLog) confirmLog.addEventListener('click', login);
    
    const confirmDel = q('confirmDelBtn');
    if(confirmDel) confirmDel.addEventListener('click', confirmDelete);
    
    const acceptCookies = q('acceptCookiesBtn');
    if(acceptCookies) {
        acceptCookies.addEventListener('click', () => {
            localStorage.setItem('cookies', 'ok');
            const cb = q('cookieBox');
            if(cb) cb.style.display = 'none';
        });
    }
    
    const startBtn = q('startBtn');
    if(startBtn) startBtn.addEventListener('click', () => showPage('books'));
    
    const ctaBtn = q('ctaBtn');
    if(ctaBtn) ctaBtn.addEventListener('click', () => showPage('books'));
    
    document.querySelectorAll('.nav-link').forEach(l => {
        l.addEventListener('click', function(e) {
            e.preventDefault();
            showPage(this.dataset.page);
        });
    });
    
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.addEventListener('click', function() {
            setFilter(this.dataset.filter);
        });
    });
    
    const addBookBtn = q('addBookBtn');
    if(addBookBtn) addBookBtn.addEventListener('click', toggleAddForm);
    
    const cancelAdd = q('cancelAddBtn');
    if(cancelAdd) cancelAdd.addEventListener('click', toggleAddForm);
    
    const confirmAdd = q('confirmAddBtn');
    if(confirmAdd) confirmAdd.addEventListener('click', addBook);
    
    const sortSelect = q('sortSelect');
    if(sortSelect) sortSelect.addEventListener('change', function() {
        currentSort = this.value;
        renderBooks();
    });
    
    const searchBtn = q('searchBtn');
    if(searchBtn) searchBtn.addEventListener('click', searchBooks);
    
    const searchInput = q('searchInput');
    if(searchInput) searchInput.addEventListener('keypress', function(e) {
        if(e.key === 'Enter') searchBooks();
    });
    
    const exportBtn = q('exportBtn');
    if(exportBtn) exportBtn.addEventListener('click', exportBooks);
    
    const importBtn = q('importBtn');
    if(importBtn) importBtn.addEventListener('click', () => {
        const f = q('importFile');
        if(f) f.click();
    });
    
    const importFile = q('importFile');
    if(importFile) importFile.addEventListener('change', function() {
        if(this.files[0]) {
            importBooks(this.files[0]);
            this.value = '';
        }
    });
    
    const prevBtn = q('prevBtn');
    if(prevBtn) prevBtn.addEventListener('click', prevPage);
    
    const nextBtn = q('nextBtn');
    if(nextBtn) nextBtn.addEventListener('click', nextPage);
    
    const saveProg = q('saveProgBtn');
    if(saveProg) saveProg.addEventListener('click', saveProgress);
    
    const markDone = q('markDoneBtn');
    if(markDone) markDone.addEventListener('click', markDone);
    
    const chatToggle = q('chatToggleBtn');
    if(chatToggle) chatToggle.addEventListener('click', toggleChat);
    
    const chatClose = q('chatCloseBtn');
    if(chatClose) chatClose.addEventListener('click', toggleChat);
    
    const chatSend = q('chatSendBtn');
    if(chatSend) chatSend.addEventListener('click', sendMsg);
    
    const chatInput = q('chatInput');
    if(chatInput) chatInput.addEventListener('keypress', function(e) {
        if(e.key === 'Enter') sendMsg();
    });
    
    window.addEventListener('click', function(e) {
        if(e.target.classList.contains('modal')) e.target.style.display = 'none';
    });
    
    showPage('home');
    console.log('✅ Inițializare completă! Toate butoanele ar trebui să funcționeze.');
}

// Pornește aplicația când DOM-ul este gata
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}