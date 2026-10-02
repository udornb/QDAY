/* Lamoon: a static, localStorage-based booking demo. All dates use Thailand time.
   Storage is shared only by tabs on the SAME browser and origin, not devices.
   Web Locks serializes read/check/write operations to prevent tab-to-tab races. */
'use strict';
const STORAGE_KEY = 'lamoon.booking.v1';
const SESSION_KEY = 'lamoon.owner.session';
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekdays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const services = ['ตัดผม', 'ทำสีผม', 'สระและจัดแต่งทรง', 'ทรีตเมนต์'];
// Old shop data keeps the original services until the owner customizes the list.
function shopServices(data = state) {
  return Array.isArray(data.shop.services) ? data.shop.services : services;
}
function serviceOptions(data = state) {
  return shopServices(data).map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
}
const defaultShop = {name:'ละมุน สตูดิโอ', owner:'', phone:'02-123-4567', description:'ดูแลเส้นผมและความรู้สึกดี ๆ ในบรรยากาศที่เป็นกันเอง', open:'09:00', close:'18:00', days:[1,2,3,4,5,6], duration:60, capacity:1};
const emptyState = () => ({version:1, shop:{...defaultShop}, bookings:[], closures:[], sequence:0, credentials:null});
let state, selectedDate, selectedTime = '', month, toastTimer;
const dateKey = date => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
const today = () => dateKey(new Date());
const parseDate = key => new Date(`${key}T12:00:00+07:00`);
const shiftDay = (key, n) => {const d = parseDate(key); d.setUTCDate(d.getUTCDate()+n); return dateKey(d);};
const prettyDate = (key, short = false) => new Intl.DateTimeFormat('th-TH', {timeZone:'Asia/Bangkok', weekday:short?undefined:'long', day:'numeric', month:short?'short':'long', year:'numeric'}).format(parseDate(key));
const minute = time => Number(time.slice(0,2))*60+Number(time.slice(3));
const clock = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const isPast = (date, time) => new Date(`${date}T${time}:00+07:00`).getTime() <= Date.now();
function readState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('อ่านข้อมูลที่บันทึกไว้ไม่ได้ กรุณาสำรองข้อมูลในเบราว์เซอร์ก่อนแก้ไข'); }
  if (data.version !== 1 || !data.shop || !Array.isArray(data.bookings) || !Array.isArray(data.closures)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง ระบบยังไม่ได้แก้ไขข้อมูลเดิม');
  return data;
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500);
}
// This session gate is for a demo only: localStorage is readable by the device owner.
function authenticated(data = state) { return Boolean(data.credentials && sessionStorage.getItem(SESSION_KEY) === data.credentials.hash); }
async function mutate(change, ownerOnly = false) {
  if (!navigator.locks) throw new Error('กรุณาใช้ Chrome, Edge, Firefox หรือ Safari รุ่นใหม่ผ่าน HTTPS เพื่อบันทึกคิวอย่างปลอดภัยระหว่างแท็บ');
  return navigator.locks.request(STORAGE_KEY, async () => {
    const current = readState();
    if (ownerOnly && !authenticated(current)) throw new Error('กรุณาเข้าสู่ระบบเจ้าของร้านอีกครั้ง');
    const result = await change(current);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); }
    catch { throw new Error('บันทึกข้อมูลไม่ได้ พื้นที่จัดเก็บอาจเต็ม หรือเบราว์เซอร์ปิดการใช้ localStorage'); }
    state = current;
    return result;
  });
}
function baseSlots(shop = state.shop) {
  const result = [];
  for (let n = minute(shop.open); n + shop.duration <= minute(shop.close); n += shop.duration) result.push(clock(n));
  return result;
}
function closureMatches(c, date, time, shop) {
  return c.date === date && (!c.start || minute(time) < minute(c.end) && minute(time) + shop.duration > minute(c.start));
}
function slotInfo(date, time, data = state, excludeId = '', includePast = false) {
  const shop = data.shop;
  const openDay = shop.days.includes(parseDate(date).getUTCDay());
  const closed = !openDay || !baseSlots(shop).includes(time) || data.closures.some(c => closureMatches(c, date, time, shop));
  const past = !includePast && isPast(date, time);
  // Count overlapping appointments, including bookings created before a duration change.
  const used = data.bookings.filter(b => b.status !== 'cancelled' && b.id !== excludeId && b.date === date && minute(b.time) < minute(time)+shop.duration && minute(b.time)+(b.duration || shop.duration) > minute(time)).length;
  return {closed, past, remaining:Math.max(0, shop.capacity-used), available:!closed && !past && used < shop.capacity};
}
function dayInfo(date) {
  const infos = baseSlots().map(t => slotInfo(date,t));
  const usable = infos.filter(s => !s.closed && !s.past);
  const free = usable.reduce((sum,s) => sum+s.remaining,0);
  if (!usable.length) return {status:'closed', label:date < today()?'ที่ผ่านมา':'ปิดรับจอง'};
  if (!free) return {status:'full', label:'คิวเต็ม'};
  return {status:free <= Math.max(2,usable.length*state.shop.capacity*.25)?'limited':'available', label:`ว่าง ${free} คิว`};
}
function calendarHTML() {
  return `<div class="calendar-card"><div class="calendar-header"><div><span class="calendar-symbol">▦</span><h3 id="month-label"></h3></div><div class="calendar-actions"><button class="today-button" id="today-button">วันนี้</button><button class="icon-button" id="prev-month" aria-label="เดือนก่อนหน้า">‹</button><button class="icon-button" id="next-month" aria-label="เดือนถัดไป">›</button></div></div><div class="weekdays">${weekdays.map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-days" id="calendar-days"></div><div class="legend"><span><i class="dot available"></i>คิวว่าง</span><span><i class="dot limited"></i>เหลือคิวน้อย</span><span><i class="dot full"></i>คิวเต็ม</span><span><i class="dot closed"></i>ปิดรับจอง</span></div></div>`;
}
function setMonth(date) { month = date.slice(0,7)+'-01'; }
function renderCalendar(admin = false) {
  $('#month-label').textContent = new Intl.DateTimeFormat('th-TH', {timeZone:'Asia/Bangkok',month:'long',year:'numeric'}).format(parseDate(month));
  const start = shiftDay(month, -parseDate(month).getUTCDay());
  const m = parseDate(month);
  const daysInMonth = new Date(Date.UTC(m.getUTCFullYear(),m.getUTCMonth()+1,0)).getUTCDate();
  const count = Math.ceil((parseDate(month).getUTCDay()+daysInMonth)/7)*7;
  let html = '';
  for (let i=0;i<count;i++) {
    const key=shiftDay(start,i), info=dayInfo(key), outside=key.slice(0,7)!==month.slice(0,7);
    const booked = state.bookings.filter(b=>b.date===key && b.status!=='cancelled').length;
    html += `<button class="day ${info.status} ${outside?'outside':''} ${key===selectedDate?'selected':''} ${key===today()?'today':''}" data-date="${key}" aria-pressed="${key===selectedDate}" aria-label="${prettyDate(key)} ${info.label}${admin?`, จองแล้ว ${booked} คิว`:''}"><span>${parseDate(key).getUTCDate()}</span><small>${admin && booked?`${booked} คิวจอง`:info.label}</small></button>`;
  }
  $('#calendar-days').innerHTML=html;
  $('#calendar-days').onclick=e=>{const b=e.target.closest('[data-date]');if(!b)return;selectedDate=b.dataset.date;selectedTime='';setMonth(selectedDate);renderCalendar(admin);admin?renderDayBookings():renderTimes();};
}
function wireCalendar(admin = false) {
  const refresh=()=>renderCalendar(admin);
  $('#prev-month').onclick=()=>{setMonth(shiftDay(month,-1));refresh();};
  $('#next-month').onclick=()=>{const d=parseDate(month);d.setUTCMonth(d.getUTCMonth()+1);setMonth(dateKey(d));refresh();};
  $('#today-button').onclick=()=>{selectedDate=today();selectedTime='';setMonth(selectedDate);refresh();admin?renderDayBookings():renderTimes();};
  refresh();
}
function renderTimes() {
  $('#selected-date-label').textContent=prettyDate(selectedDate,true);
  const slots=baseSlots(), free=slots.filter(t=>slotInfo(selectedDate,t).available);
  if (!free.includes(selectedTime)) selectedTime='';
  $('#availability-count').textContent=free.length?`มี ${free.length} ช่วงเวลาว่างให้คุณเลือก`:'ไม่มีช่วงเวลาว่างในวันนี้';
  $('#duration-label').textContent=`${state.shop.duration} นาที`;
  $('#time-slots').innerHTML=slots.map(time=>{const s=slotInfo(selectedDate,time);return `<button class="slot ${time===selectedTime?'selected':''}" data-time="${time}" ${s.available?'':'disabled'} aria-pressed="${time===selectedTime}">${time}<small>${s.closed?'ปิดรับจอง':s.past?'ผ่านแล้ว':!s.remaining?'เต็ม':state.shop.capacity>1?`ว่าง ${s.remaining} ที่`:'ว่าง'}</small></button>`;}).join('') || '<p class="empty">ร้านยังไม่ได้กำหนดช่วงเวลา</p>';
  $('#time-slots').onclick=e=>{const b=e.target.closest('[data-time]');if(!b || b.disabled)return;selectedTime=b.dataset.time;renderTimes();};
  const next=$('#continue-booking');next.classList.toggle('disabled',!selectedTime);next.setAttribute('aria-disabled',String(!selectedTime));next.href=`booking.html?date=${selectedDate}&time=${selectedTime}`;
  next.onclick=e=>{if(!selectedTime){e.preventDefault();toast('เลือกช่วงเวลาที่ว่างก่อนดำเนินการต่อ');}};
  $('.safe-note').textContent=selectedTime?`เลือกเวลา ${selectedTime} น. แล้ว พร้อมจองได้เลย`:'เลือกช่วงเวลาเพื่อดำเนินการต่อ';
}
function renderShop() {
  const hero = $('.hero-photo > img');
  hero.src = shopImageSource(state.shop.heroImage);
  hero.alt = `ภาพหน้าร้าน ${state.shop.name}`;
  $('#shop-name').textContent=state.shop.name;$('#shop-description').textContent=state.shop.description;
  $('#shop-hours').textContent=`${state.shop.open} – ${state.shop.close} น.`;
  $('#shop-days').textContent=`เปิด ${state.shop.days.map(d=>weekdays[d]).join(' / ')}`;
  $('#shop-phone').textContent=state.shop.phone;$('#year').textContent=new Date().getFullYear();
  document.title=`${state.shop.name} — จองคิวออนไลน์`;
}
function home() {
  selectedDate=today();
  for(let i=0;i<60;i++){const d=shiftDay(today(),i);if(baseSlots().some(t=>slotInfo(d,t).available)){selectedDate=d;break;}}
  setMonth(selectedDate);renderShop();wireCalendar();renderTimes();
}
// PBKDF2 avoids storing the owner's password in plain text. This is not server authentication.
async function passwordHash(password,salt) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
function validateBooking(data, current, excludeId='') {
  const previous = excludeId && current.bookings.find(b => b.id === excludeId);
  const validService = shopServices(current).includes(data.service) || previous?.service === data.service;
  if (!data.name.trim() || !/^[0-9+() -]{8,20}$/.test(data.phone) || !validService) throw new Error('กรุณากรอกชื่อ เบอร์โทรศัพท์ และเลือกบริการที่ร้านเปิดให้จอง');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !/^\d{2}:\d{2}$/.test(data.time) || !slotInfo(data.date,data.time,current,excludeId).available) throw new Error('ช่วงเวลานี้ไม่ว่างแล้ว หรือปิดรับจอง กรุณาเลือกช่วงเวลาใหม่');
}
async function saveBooking(data, owner=false) {
  return mutate(current=>{
    const old=data.id?current.bookings.find(b=>b.id===data.id):null;
    if(data.id && (!owner || !old || old.status==='cancelled')) throw new Error('ไม่สามารถแก้ไขรายการนี้ได้');
    validateBooking(data,current,old?.id);
    if(old){Object.assign(old,{name:data.name.trim(),phone:data.phone,service:data.service,date:data.date,time:data.time,note:data.note,duration:current.shop.duration});return old;}
    const booking={id:crypto.randomUUID(),queue:`L${String(++current.sequence).padStart(4,'0')}`,name:data.name.trim(),phone:data.phone,service:data.service,date:data.date,time:data.time,note:data.note,duration:current.shop.duration,status:'confirmed',createdAt:new Date().toISOString()};
    current.bookings.push(booking);return booking;
  },owner);
}
function bookingPage() {
  const params=new URLSearchParams(location.search), receipt=params.get('receipt');
  if(receipt){const b=state.bookings.find(b=>b.id===receipt);if(b){renderReceipt(b);return;}}
  const date=params.get('date'), time=params.get('time');
  if(!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !slotInfo(date,time).available){$('#booking-content').innerHTML='<div class="panel"><h2>มาเลือกเวลาที่สะดวกกัน</h2><p class="muted">ยังไม่ได้เลือกเวลา หรือช่วงเวลาที่เลือกไม่ว่างแล้ว</p><a class="button" style="margin-top:20px" href="index.html#calendar">เลือกวันและเวลาใหม่ →</a></div>';return;}
  $('#booking-content').innerHTML=`<div class="summary-box"><strong>${esc(state.shop.name)}</strong><br>${prettyDate(date)} · ${time} น. · ${state.shop.duration} นาที</div><form id="customer-form" class="panel form-grid"><label>ชื่อลูกค้า <input name="name" autocomplete="name" placeholder="ชื่อของคุณ" required maxlength="80"></label><label>เบอร์โทรศัพท์ <input name="phone" type="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" required pattern="[0-9+() -]{8,20}"></label><label class="full-width">บริการที่ต้องการ <select name="service" required><option value="">เลือกบริการ</option>${serviceOptions()}</select></label><label>วันที่<input name="date" type="date" value="${date}" readonly></label><label>เวลา<input name="time" type="time" value="${time}" readonly></label><label class="full-width">หมายเหตุ <textarea name="note" maxlength="500" placeholder="สิ่งที่อยากให้เราทราบ (ไม่บังคับ)"></textarea></label><p class="muted full-width">ข้อมูลนี้จะถูกบันทึกในเบราว์เซอร์นี้สำหรับทดลองระบบเท่านั้น</p><p class="form-error full-width" role="alert"></p><button class="button full-width" type="submit">ยืนยันการจอง <span>→</span></button></form>`;
  $('#customer-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,btn=$('button',form);btn.disabled=true;
    try{const b=await saveBooking(Object.fromEntries(new FormData(form)));history.replaceState(null,'',`booking.html?receipt=${b.id}`);renderReceipt(b);}
    catch(err){$('.form-error',form).textContent=err.message;btn.disabled=false;}
  };
}
function renderReceipt(b) {
  $('#booking-content').innerHTML=`<div class="panel success"><div class="success-icon">${b.status==='cancelled'?'×':'✓'}</div><h2>${b.status==='cancelled'?'คิวนี้ถูกยกเลิกแล้ว':'จองคิวเรียบร้อยแล้ว'}</h2><p class="muted">${b.status==='cancelled'?'เลือกเวลาใหม่ได้ที่หน้าร้าน':'แล้วพบกันนะคะ เราพร้อมดูแลคุณ'}</p><p class="queue-number">${esc(b.queue)}</p><p class="muted">เลขคิวของคุณ</p><div class="summary-box"><strong>${esc(state.shop.name)}</strong><br>${prettyDate(b.date)} · ${esc(b.time)} น.<br>${esc(b.name)} · ${esc(b.service)}<br>โทร ${esc(b.phone)}${b.note?`<br>หมายเหตุ: ${esc(b.note)}`:''}</div><p class="muted">บันทึกภาพหน้าจอนี้ไว้ และมาถึงก่อนเวลานัด 10 นาที</p><a class="button" style="margin-top:20px" href="index.html">กลับหน้าร้าน →</a></div>`;
}
function settingsFields(shop, setup=false) {
  return `<label>ชื่อเจ้าของร้าน<input name="owner" required maxlength="80" value="${esc(shop.owner)}"></label><label>ชื่อร้าน<input name="name" required maxlength="100" value="${esc(shop.name)}"></label>${setup?'<label class="full-width">รหัสผ่านสำหรับเข้าหน้าจัดการ<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร"></label>':''}<label class="full-width">รายละเอียดร้าน<textarea name="description" maxlength="300">${esc(shop.description)}</textarea></label><label class="full-width">เบอร์โทรร้าน<input name="phone" type="tel" required pattern="[0-9+() -]{8,20}" value="${esc(shop.phone)}"></label><label>เวลาเปิด<input name="open" type="time" required value="${shop.open}"></label><label>เวลาปิด<input name="close" type="time" required value="${shop.close}"></label><label>ระยะเวลาต่อหนึ่งคิว<select name="duration">${[15,30,45,60,90,120].map(n=>`<option value="${n}" ${shop.duration===n?'selected':''}>${n} นาที</option>`).join('')}</select></label><label>จำนวนลูกค้าต่อช่วงเวลา<input name="capacity" type="number" min="1" max="50" required value="${shop.capacity}"></label><div class="full-width"><p class="muted" style="margin-bottom:9px">วันเปิดทำการ</p><div class="weekday-options">${weekdays.map((d,i)=>`<label><input type="checkbox" name="days" value="${i}" ${shop.days.includes(i)?'checked':''}>${d}</label>`).join('')}</div></div><p class="form-error full-width" role="alert"></p><button class="button full-width">${setup?'เปิดใช้งานร้านของคุณ →':'บันทึกการตั้งค่า'}</button>`;
}
function shopFromForm(form) {
  const f=new FormData(form), shop={owner:f.get('owner').trim(),name:f.get('name').trim(),description:f.get('description').trim(),phone:f.get('phone'),open:f.get('open'),close:f.get('close'),duration:Number(f.get('duration')),capacity:Number(f.get('capacity')),days:f.getAll('days').map(Number)};
  if(!shop.owner || !shop.name || !shop.days.length) throw new Error('กรอกชื่อ และเลือกวันเปิดทำการอย่างน้อย 1 วัน');
  if(minute(shop.close)-minute(shop.open)<shop.duration) throw new Error('เวลาปิดต้องหลังเวลาเปิด และมีเวลาพอสำหรับอย่างน้อยหนึ่งคิว');
  if(!Number.isInteger(shop.capacity) || shop.capacity<1 || shop.capacity>50) throw new Error('จำนวนลูกค้าต้องเป็นจำนวนเต็ม 1–50 คน');
  // Keep the separately managed cover photo when saving shop details.
  return {...shop, heroImage:state.shop.heroImage || '', services:[...shopServices()]};
}

function renderServiceSettings() {
  const container = document.createElement('section');
  container.className = 'panel service-settings';
  container.innerHTML = `
    <h2>บริการของร้าน</h2>
    <p class="muted">เพิ่มบริการที่ร้านทำได้ เพื่อให้ลูกค้าเลือกตอนจองคิว</p>
    <form class="form-grid" style="margin-top:20px">
      <label class="full-width">ชื่อบริการ
        <input name="serviceName" required maxlength="80" placeholder="เช่น ต่อขนตา ทำเล็บ หรือนวดผ่อนคลาย">
      </label>
      <p class="form-error full-width" role="alert"></p>
      <button class="button full-width" type="submit">+ เพิ่มบริการ</button>
    </form>
    <div data-service-list></div>
    <p class="muted" style="margin-top:15px">ทุกบริการใช้ระยะเวลาต่อคิวตามการตั้งค่าร้าน การนำบริการออกจะไม่เปลี่ยนรายละเอียดคิวที่จองไว้แล้ว</p>`;
  $('.settings-columns').before(container);
  const form = $('form', container);
  const error = $('.form-error', form);
  const list = $('[data-service-list]', container);
  const renderList = () => {
    list.innerHTML = shopServices().map((name, index) => `<div class="closure-item"><span>${esc(name)}</span><button class="secondary" type="button" data-remove-service="${index}" aria-label="นำบริการ ${esc(name)} ออก">นำออก</button></div>`).join('');
  };
  renderList();
  form.onsubmit = async event => {
    event.preventDefault();
    const name = form.elements.serviceName.value.trim().replace(/\s+/g, ' ');
    const button = $('button', form);
    button.disabled = true;
    error.textContent = '';
    try {
      await mutate(data => {
        const current = shopServices(data);
        if (!name || name.length > 80) throw new Error('กรุณากรอกชื่อบริการไม่เกิน 80 ตัวอักษร');
        if (current.some(s => s.toLocaleLowerCase('th') === name.toLocaleLowerCase('th'))) throw new Error('มีบริการชื่อนี้แล้ว');
        if (current.length >= 50) throw new Error('เพิ่มบริการได้สูงสุด 50 รายการ');
        data.shop.services = [...current, name];
      }, true);
      form.reset();
      renderList();
      toast('เพิ่มบริการแล้ว ลูกค้าสามารถเลือกตอนจองได้');
    } catch (err) { error.textContent = err.message; }
    finally { button.disabled = false; }
  };
  list.onclick = async event => {
    const button = event.target.closest('[data-remove-service]');
    if (!button) return;
    const name = shopServices()[Number(button.dataset.removeService)];
    if (!confirm(`นำบริการ “${name}” ออกจากรายการที่เปิดให้จอง?`)) return;
    error.textContent = '';
    try {
      await mutate(data => {
        const remaining = shopServices(data).filter(s => s !== name);
        if (!remaining.length) throw new Error('ร้านต้องมีอย่างน้อย 1 บริการ กรุณาเพิ่มบริการใหม่ก่อน');
        data.shop.services = remaining;
      }, true);
      renderList();
      toast('นำบริการออกแล้ว');
    } catch (err) { error.textContent = err.message; }
  };
}

function shopImageSource(value) {
  return typeof value === 'string' && /^data:image\/jpeg;base64,/.test(value)
    ? value : 'assets/studio.jpg';
}

// Resize uploads before storing them: localStorage has a small per-site quota.
async function prepareShopImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('กรุณาเลือกภาพ JPG, PNG หรือ WebP');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('กรุณาเลือกภาพขนาดไม่เกิน 10 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error('อ่านภาพนี้ไม่ได้ กรุณาเลือกไฟล์ภาพใหม่'); }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fafbf7';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.8);
    if (result.length > 1500000) throw new Error('ภาพนี้ยังมีขนาดใหญ่เกินไป กรุณาเลือกภาพที่เล็กลง');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

function renderImageSettings() {
  const container = document.createElement('section');
  container.className = 'panel image-settings';
  container.innerHTML = `
    <h2>รูปภาพหน้าแรก</h2>
    <p class="muted">เลือกภาพร้านของคุณ เพื่อแสดงข้างข้อความต้อนรับบนหน้าแรก</p>
    <img class="shop-image-preview" alt="ตัวอย่างภาพหน้าแรก">
    <form class="form-grid">
      <label class="full-width">เลือกรูปภาพ
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-hint">
      </label>
      <p id="photo-hint" class="muted full-width">รองรับ JPG, PNG และ WebP ไม่เกิน 10 MB · แนะนำภาพแนวนอน ระบบจะย่อภาพให้อัตโนมัติ</p>
      <p class="full-width" role="status" data-photo-status></p>
      <button class="secondary" type="button" data-reset-photo>ใช้ภาพเริ่มต้น</button>
      <button class="button" type="submit">บันทึกรูปภาพ</button>
    </form>`;
  $('.settings-columns').before(container);
  const preview = $('.shop-image-preview', container);
  const form = $('form', container);
  const status = $('[data-photo-status]', container);
  let pending = state.shop.heroImage || '';
  preview.src = shopImageSource(pending);
  const busy = value => form.querySelectorAll('input, button').forEach(el => el.disabled = value);
  form.elements.photo.onchange = async () => {
    const file = form.elements.photo.files[0];
    if (!file) return;
    busy(true);
    status.className = 'muted full-width';
    status.textContent = 'กำลังเตรียมรูปภาพ…';
    try {
      pending = await prepareShopImage(file);
      preview.src = pending;
      status.textContent = 'ตัวอย่างรูปใหม่ · กดบันทึกรูปภาพเพื่อแสดงบนหน้าแรก';
    } catch (err) {
      status.className = 'form-error full-width';
      status.textContent = err.message;
      form.elements.photo.value = '';
    } finally { busy(false); }
  };
  $('[data-reset-photo]', container).onclick = () => {
    pending = '';
    form.elements.photo.value = '';
    preview.src = shopImageSource(pending);
    status.className = 'muted full-width';
    status.textContent = 'เลือกภาพเริ่มต้นแล้ว · กดบันทึกรูปภาพเพื่อยืนยัน';
  };
  form.onsubmit = async event => {
    event.preventDefault();
    busy(true);
    try {
      await mutate(data => { data.shop.heroImage = pending; }, true);
      status.className = 'muted full-width';
      status.textContent = 'บันทึกแล้ว รูปนี้จะแสดงบนหน้าแรก';
      toast('บันทึกรูปภาพหน้าแรกแล้ว');
    } catch (err) {
      status.className = 'form-error full-width';
      status.textContent = err.message;
    } finally { busy(false); }
  };
}
// A schedule edit must not silently invalidate an already confirmed future booking.
function assertSchedule(data) {
  for(const b of data.bookings.filter(b=>b.status!=='cancelled' && !isPast(b.date,b.time))){
    if(!slotInfo(b.date,b.time,data,b.id).available || (b.duration || data.shop.duration)!==data.shop.duration) throw new Error(`การตั้งค่านี้กระทบคิว ${b.queue} วันที่ ${prettyDate(b.date,true)} ${b.time} กรุณาย้ายหรือยกเลิกคิวนั้นก่อน`);
  }
}
function adminPage() {
  $('#logout').hidden=!authenticated();
  if(!state.credentials){renderSetup();return;}
  if(!authenticated()){renderLogin();return;}
  selectedDate ||= today();setMonth(selectedDate);renderDashboard();
}
function renderSetup() {
  $('#admin-content').innerHTML=`<section class="setup-wrap"><span class="eyebrow">WELCOME TO YOUR STUDIO</span><h1>เริ่มต้นร้านของคุณ</h1><p class="muted">ตั้งค่าเพียงครั้งเดียว แล้วให้ระบบจัดตารางคิวให้คุณ</p><form id="setup-form" class="panel form-grid">${settingsFields(state.shop,true)}</form><p class="muted">รหัสผ่านนี้ใช้ล็อกหน้าจัดการในเบราว์เซอร์นี้เท่านั้น ข้อมูลบนอุปกรณ์ยังเข้าถึงได้ผ่านเครื่องมือของเบราว์เซอร์</p></section>`;
  $('#setup-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=$('button',form);button.disabled=true;try{const shop=shopFromForm(form),password=new FormData(form).get('password'),salt=crypto.randomUUID(),hash=await passwordHash(password,salt);await mutate(data=>{if(data.credentials)throw new Error('มีการตั้งค่าร้านแล้วในแท็บอื่น กรุณาโหลดหน้าใหม่');data.shop=shop;assertSchedule(data);data.credentials={salt,hash};});sessionStorage.setItem(SESSION_KEY,hash);adminPage();toast('ร้านของคุณพร้อมใช้งานแล้ว');}catch(err){$('.form-error',form).textContent=err.message;button.disabled=false;}};
}
function renderLogin() {
  $('#admin-content').innerHTML=`<section class="setup-wrap"><span class="eyebrow">A LITTLE SPACE FOR YOUR BUSINESS</span><h1>ยินดีต้อนรับกลับมา</h1><p class="muted">เข้าสู่หน้าจัดการ ${esc(state.shop.name)}</p><form id="login-form" class="panel form-grid"><label class="full-width">รหัสผ่านเจ้าของร้าน<input name="password" type="password" required autocomplete="current-password"></label><p class="form-error full-width" role="alert"></p><button class="button full-width">เข้าสู่ระบบ →</button></form><p class="muted">ระบบทดลองเก็บข้อมูลเฉพาะเบราว์เซอร์ รหัสผ่านนี้ไม่ใช่ระบบรักษาความปลอดภัยสำหรับการใช้งานจริง</p></section>`;
  $('#login-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,btn=$('button',f);btn.disabled=true;try{state=readState();const hash=await passwordHash(new FormData(f).get('password'),state.credentials.salt);if(hash!==state.credentials.hash)throw new Error('รหัสผ่านไม่ถูกต้อง กรุณาลองอีกครั้ง');sessionStorage.setItem(SESSION_KEY,hash);adminPage();}catch(err){$('.form-error',f).textContent=err.message;btn.disabled=false;}};
}
function renderDashboard() {
  $('#admin-content').innerHTML=`<div class="admin-top"><div><span class="eyebrow">YOUR STUDIO, AT A GLANCE</span><h1>สวัสดี คุณ${esc(state.shop.owner)}</h1><p class="muted">ดูแลทุกคิวของ ${esc(state.shop.name)} ได้จากที่เดียว</p></div><button class="button" id="add-booking">+ เพิ่มคิวด้วยตัวเอง</button></div><div class="stats" id="stats"></div><div class="admin-layout">${calendarHTML()}<section class="panel"><div class="admin-top"><h2 style="font-size:19px">คิวประจำวันที่เลือก</h2><input id="admin-date" class="date-picker" style="width:auto" type="date" value="${selectedDate}" aria-label="เลือกวันที่ดูคิว"></div><p id="admin-day-label" class="muted" style="margin-top:12px"></p><div id="day-bookings"></div></section></div><div class="settings-columns"><section class="panel"><h2>ตั้งค่าร้านและเวลาทำการ</h2><form id="settings-form" class="form-grid">${settingsFields(state.shop)}</form></section><section class="panel"><h2>วันหยุดและช่วงเวลาปิดรับจอง</h2><form id="closure-form" class="form-grid"><label class="full-width">วันที่<input type="date" name="date" required min="${today()}" value="${selectedDate}"></label><label class="full-width">ประเภท<select name="type"><option value="day">ปิดทั้งวัน / วันหยุด</option><option value="time">ปิดเฉพาะช่วงเวลา</option></select></label><label class="closure-time" hidden>ตั้งแต่<input type="time" name="start" value="12:00"></label><label class="closure-time" hidden>ถึง<input type="time" name="end" value="13:00"></label><label class="full-width">เหตุผล<input name="reason" maxlength="100" placeholder="เช่น วันหยุดร้าน หรือพักกลางวัน"></label><p class="form-error full-width" role="alert"></p><button class="secondary full-width">+ เพิ่มช่วงปิดรับจอง</button></form><div id="closures-list" style="margin-top:20px"></div></section></div><p class="demo-note">ข้อมูลทั้งหมดอยู่ในเบราว์เซอร์นี้ · ยังไม่รองรับการใช้งานร่วมกันต่างอุปกรณ์</p>`;
  $('#logout').hidden=false;$('#logout').onclick=()=>{sessionStorage.removeItem(SESSION_KEY);adminPage();};
  wireCalendar(true);renderStats();renderDayBookings();renderClosures();renderImageSettings();renderServiceSettings();
  $('#admin-date').onchange=e=>{if(!e.target.value)return;selectedDate=e.target.value;setMonth(selectedDate);renderCalendar(true);renderDayBookings();};
  $('#add-booking').onclick=()=>openBookingDialog();
  $('#close-dialog').onclick=()=>$('#booking-dialog').close();
  $('#settings-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{const shop=shopFromForm(form);await mutate(d=>{d.shop=shop;assertSchedule(d);},true);renderCalendar(true);renderStats();toast('บันทึกการตั้งค่าแล้ว');$('.form-error',form).textContent='';}catch(err){$('.form-error',form).textContent=err.message;}};
  const cf=$('#closure-form');cf.elements.type.onchange=()=>cf.querySelectorAll('.closure-time').forEach(el=>el.hidden=cf.elements.type.value==='day');
  cf.onsubmit=async e=>{e.preventDefault();try{const f=new FormData(cf),partial=f.get('type')==='time',c={id:crypto.randomUUID(),date:f.get('date'),start:partial?f.get('start'):'',end:partial?f.get('end'):'',reason:f.get('reason').trim()||'ปิดรับจอง'};if(partial && (!c.start || !c.end || c.start>=c.end))throw new Error('เวลาเริ่มต้องก่อนเวลาสิ้นสุด');await mutate(d=>{d.closures.push(c);assertSchedule(d);},true);$('.form-error',cf).textContent='';renderClosures();renderCalendar(true);toast('เพิ่มช่วงปิดรับจองแล้ว');}catch(err){$('.form-error',cf).textContent=err.message;}};
}
function renderStats() {
  const active=state.bookings.filter(b=>b.status!=='cancelled');
  const items=[['คิววันนี้',active.filter(b=>b.date===today()).length],['คิวพรุ่งนี้',active.filter(b=>b.date===shiftDay(today(),1)).length],['จำนวนคิวทั้งหมด',state.bookings.length],['คิวที่ยกเลิก',state.bookings.length-active.length]];
  $('#stats').innerHTML=items.map(([label,n])=>`<div class="stat"><span>${label}</span><strong>${n}<small style="font-size:12px;font-weight:400;margin-left:8px">คิว</small></strong></div>`).join('');
}
function renderDayBookings() {
  $('#admin-date').value=selectedDate;$('#admin-day-label').textContent=prettyDate(selectedDate);
  const bookings=state.bookings.filter(b=>b.date===selectedDate).sort((a,b)=>a.time.localeCompare(b.time));
  $('#day-bookings').innerHTML=bookings.map(b=>`<article class="admin-booking ${b.status==='cancelled'?'cancelled':''}"><div><h3>${esc(b.time)} — ${esc(b.name)} — ${esc(b.service)}</h3><p>${esc(b.queue)} · ${esc(b.phone)} · ${b.status==='cancelled'?'ยกเลิกแล้ว':'ยืนยันแล้ว'}</p>${b.note?`<p>${esc(b.note)}</p>`:''}</div>${b.status!=='cancelled'?`<div class="row-actions">${!isPast(b.date,b.time)?`<button class="secondary" data-edit="${b.id}">แก้ไข</button>`:''}<button class="secondary" data-cancel="${b.id}">ยกเลิก</button></div>`:''}</article>`).join('')||'<div class="empty">ยังไม่มีคิวในวันนี้<br>เวลาดี ๆ กำลังรอให้ใครสักคนจอง</div>';
  $('#day-bookings').onclick=async e=>{const edit=e.target.closest('[data-edit]'),cancel=e.target.closest('[data-cancel]');if(edit)openBookingDialog(state.bookings.find(b=>b.id===edit.dataset.edit));if(cancel && confirm('ยืนยันยกเลิกคิวนี้?')){try{await mutate(d=>{const b=d.bookings.find(b=>b.id===cancel.dataset.cancel);if(!b)throw new Error('ไม่พบคิวนี้');b.status='cancelled';},true);renderStats();renderDayBookings();renderCalendar(true);toast('ยกเลิกคิวแล้ว');}catch(err){toast(err.message);}}};
}
function renderClosures() {
  $('#closures-list').innerHTML=[...state.closures].sort((a,b)=>a.date.localeCompare(b.date)).map(c=>`<div class="closure-item"><div>${prettyDate(c.date,true)} · ${c.start?`${c.start}–${c.end}`:'ปิดทั้งวัน'}<p class="muted">${esc(c.reason)}</p></div><button class="secondary" data-remove="${c.id}">เปิดรับจอง</button></div>`).join('')||'<p class="empty">ยังไม่มีวันหยุดเพิ่มเติม</p>';
  $('#closures-list').onclick=async e=>{const b=e.target.closest('[data-remove]');if(!b)return;try{await mutate(d=>{d.closures=d.closures.filter(c=>c.id!==b.dataset.remove);},true);renderClosures();renderCalendar(true);toast('เปิดรับจองอีกครั้งแล้ว');}catch(err){toast(err.message);}};
}
function openBookingDialog(booking) {
  const dialog=$('#booking-dialog'),form=$('#admin-booking-form');form.reset();$('.form-error',form).textContent='';
  $('#dialog-title').textContent=booking?'แก้ไขคิว':'เพิ่มคิวด้วยตัวเอง';form.elements.id.value=booking?.id||'';
  form.elements.service.innerHTML = serviceOptions();
  if (booking && !shopServices().includes(booking.service)) {
    // Existing appointments retain their service even after it is removed from sale.
    form.elements.service.add(new Option(`${booking.service} (บริการเดิม)`, booking.service));
  }
  for(const name of ['name','phone','service','note']) if(booking)form.elements[name].value=booking[name];
  form.elements.date.min=today();form.elements.date.value=booking?.date||selectedDate;
  const updateOptions=()=>{const date=form.elements.date.value;form.elements.time.innerHTML=baseSlots().map(t=>{const s=slotInfo(date,t,state,booking?.id);return `<option value="${t}" ${s.available?'':'disabled'}>${t} ${s.closed?'(ปิด)':s.past?'(ผ่านแล้ว)':!s.remaining?'(เต็ม)':''}</option>`;}).join('');const first=Array.from(form.elements.time.options).find(o=>!o.disabled);form.elements.time.value=first?.value||'';};
  updateOptions();if(booking)form.elements.time.value=booking.time;form.elements.date.onchange=updateOptions;
  form.onsubmit=async e=>{e.preventDefault();const btn=$('button',form);btn.disabled=true;try{const b=await saveBooking(Object.fromEntries(new FormData(form)),true);selectedDate=b.date;setMonth(selectedDate);dialog.close();renderStats();renderCalendar(true);renderDayBookings();toast('บันทึกคิวแล้ว');}catch(err){$('.form-error',form).textContent=err.message;}finally{btn.disabled=false;}};
  dialog.showModal();
}
// Re-read changes from other tabs; form submissions always validate current state again.
window.addEventListener('storage',e=>{if(e.key!==STORAGE_KEY)return;try{state=readState();const page=document.body.dataset.page;if(page==='home'){renderShop();renderCalendar();renderTimes();}else if(page==='admin'){if(!authenticated())adminPage();else{renderStats();renderCalendar(true);renderDayBookings();renderClosures();}}else if(page==='booking' && new URLSearchParams(location.search).has('receipt'))bookingPage();}catch(err){toast(err.message);}});
try {
  state=readState();
  const page=document.body.dataset.page;
  if(page==='home')home();else if(page==='booking')bookingPage();else if(page==='admin')adminPage();
  // Expired slots should not remain selectable on a page left open for hours.
  if(page==='home')setInterval(()=>{state=readState();renderCalendar();renderTimes();},60000);
} catch(err) {
  const notice=document.createElement('div');notice.className='error-message';notice.textContent=err.message;document.querySelector('main').prepend(notice);
}
