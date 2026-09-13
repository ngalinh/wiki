/* Quiz identity is verified by the server; managers are wiki Admins and Editors. */
const Quiz = (() => {
  let meta, attempt, answers = [], bank, revision, busy = false, draft, displayedResult, changedTypes = new Map();
  const root = () => document.getElementById('quiz-content');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const questionText = q => q.id?.startsWith('form-') ? q.prompt.replace(/^\s*\d+\s*[.)]\s*/, '') : q.prompt;
  const sources = { 'cach-lam-viec': 'Cách làm việc', 'bao-gia': 'Tư vấn & Báo giá', 'tao-don': 'Follow đơn', 'bao-hang-ve': 'Báo hàng về', 'hang-stock': 'Hàng stock', faq: 'FAQ', 'thuat-ngu': 'Thuật ngữ', 'noi-quy': 'Nội quy chung' };
  async function api(url = '', options = {}) {
    const response = await fetch('./api/quiz' + url, { ...options, headers: { 'Content-Type': 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Không thực hiện được yêu cầu.');
    return data;
  }
  function error(e) { (document.querySelector('#quiz-create-dialog[open] #quiz-dialog-error') || document.getElementById('quiz-error')).textContent = e.message; }
  function toolbar() {
    document.getElementById('quiz-error').textContent = '';
    document.getElementById('quiz-tools').innerHTML = `<button class="btn btn-secondary" data-quiz="home">Làm bài</button><button class="btn btn-secondary" data-quiz="results">${meta.canManage ? 'Kết quả nhân viên' : 'Kết quả của tôi'}</button>${meta.canManage ? '<button class="btn btn-secondary" data-quiz="bank">Ngân hàng câu hỏi</button>' : ''}`;
    setActive('home');
  }
  function setActive(item) {
    document.querySelectorAll('#quiz-tools [data-quiz]').forEach(button => {
      const active = button.dataset.quiz === item;
      button.classList.toggle('quiz-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  async function load() {
    try {
      meta = await api(); toolbar();
      if (meta.active) {
        attempt = meta.active;
        try { const saved = JSON.parse(sessionStorage.getItem('wiki-quiz-' + attempt.id)); answers = Array.isArray(saved) && saved.length === 50 ? saved : Array(50).fill(null); }
        catch { answers = Array(50).fill(null); }
        renderAttempt();
      } else {
        attempt = null;
        root().innerHTML = `<div class="quiz-panel"><h2>Kiểm tra kiến thức quy trình</h2><p>Mỗi lượt gồm <strong>50 câu ngẫu nhiên</strong>: 20 trả lời ngắn, 20 trắc nghiệm, 5 tự luận và 5 đúng/sai từ ngân hàng. Mỗi câu đúng được 2 điểm, tổng 100 điểm.</p><p><strong>Success: từ 80 điểm · Failed: dưới 80 điểm.</strong></p><p class="quiz-meta">Không giới hạn thời gian. Trả lời đủ 50 câu để nộp. Kết quả lưu cho bạn, Admin và Editor; câu tự luận và câu chưa có đáp án chuẩn cần được chấm trước khi có kết quả cuối cùng; sau khi nộp có thể xem đáp án và nguồn wiki.</p><p class="quiz-meta">Tài khoản: ${esc(meta.email)} · Đang chọn ${meta.available.mc} câu trắc nghiệm / ${meta.available.tf} câu đúng/sai / ${meta.available.paragraph} câu tự luận / ${meta.available.short || 0} câu trả lời ngắn.</p><label>Họ tên nhân viên<input id="quiz-name" type="text" maxlength="120" autocomplete="name" placeholder="Nhập họ và tên"></label><button class="btn btn-primary" data-quiz="start">Bắt đầu làm bài</button></div>`;
      }
    } catch (e) { root().innerHTML = ''; document.getElementById('quiz-tools').innerHTML = ''; meta = null; error(e); }
  }
  async function start() {
    const name = document.getElementById('quiz-name').value.trim();
    if (!name) throw Error('Vui lòng nhập họ tên.');
    attempt = await api('/attempts', { method: 'POST', body: JSON.stringify({ name }) });
    answers = Array(50).fill(null); renderAttempt();
  }
  async function restart() {
    if (!confirm('Thay đề đang làm bằng đề mới? Câu trả lời chưa nộp sẽ không được chuyển sang đề mới.')) return;
    const previous = attempt.id;
    attempt = await api('/attempts', { method: 'POST', body: JSON.stringify({ name: attempt.name, replaceAttemptId: previous }) });
    try { sessionStorage.removeItem('wiki-quiz-' + previous); } catch {}
    answers = Array(50).fill(null); renderAttempt();
  }
  const typeName = type => ({ mc: 'Trắc nghiệm', tf: 'Đúng / Sai', paragraph: 'Tự luận', short: 'Trả lời ngắn' }[type]);
  const numberTag = (i, q) => `<span class="quiz-number" aria-label="Câu ${i + 1}">${String(i + 1).padStart(2, '0')}</span><div class="quiz-heading-copy"><h3>${esc(questionText(q))}</h3></div>`;
  function media(q) {
    return `${q.image ? `<figure class="quiz-media"><img src="${esc(q.image)}" alt="${esc(q.imageAlt || 'Hình minh họa câu hỏi')}" loading="lazy"><figcaption>${esc(q.imageAlt)} · <a href="${esc(q.image)}" target="_blank" rel="noopener noreferrer">Mở ảnh gốc ↗</a></figcaption></figure>` : ''}${q.productUrl ? `<a class="quiz-product-link" href="${esc(q.productUrl)}" target="_blank" rel="noopener noreferrer">Xem sản phẩm tham khảo ↗</a>` : ''}`;
  }
  const answered = a => a !== null && a !== undefined && (typeof a === 'object' ? Boolean(a.text?.trim()) : typeof a === 'string' ? Boolean(a.trim()) : true);
  function renderAttempt() {
    root().innerHTML = `<p class="quiz-meta">${esc(attempt.name)} · 50 câu · 2 điểm/câu. Đây là đề đã lưu khi bắt đầu; sửa hoặc xóa câu trong ngân hàng không cập nhật đề này.</p><p class="quiz-meta">${Object.entries({short:"trả lời ngắn",mc:"trắc nghiệm",paragraph:"tự luận",tf:"đúng/sai"}).map(([t,n])=>attempt.questions.filter(q=>q.type===t).length+" "+n).join(" · ")}</p><button class="btn btn-secondary" data-quiz="restart">Bắt đầu đề mới từ ngân hàng hiện tại</button>${attempt.questions.map((q, i) => `<fieldset class="quiz-panel quiz-question" id="quiz-q-${i}"><legend class="quiz-sr-only">Câu ${i + 1}: ${esc(questionText(q))}</legend><div class="quiz-question-head">${numberTag(i, q)}<span class="quiz-points">2 điểm</span></div>${media(q)}${['paragraph', 'short'].includes(q.type) ? `<label>Câu trả lời của bạn<${q.type === 'short' ? 'input type="text" value="' + esc(answers[i]) + '"' : 'textarea'} data-answer="${i}" data-paragraph="true" maxlength="5000" placeholder="Trình bày câu trả lời…">${q.type === 'short' ? '' : esc(answers[i]) + '</textarea>'}</label><p class="quiz-meta">Admin hoặc Editor sẽ chấm theo đáp án tham khảo.</p>` : q.options.map((o, j) => `<label class="quiz-choice"><input type="radio" name="quiz-answer-${i}" data-answer="${i}" value="${j}" ${(answers[i]?.option ?? answers[i]) === j ? 'checked' : ''}><span class="quiz-option-letter">${String.fromCharCode(65 + j)}</span><span>${esc(o)}</span></label>${q.otherOption === j ? `<input type="text" data-other-answer="${i}" maxlength="5000" aria-label="Mục khác" placeholder="Mục khác…" value="${esc(answers[i]?.text)}">` : ''}`).join('')}</fieldset>`).join('')}<div class="quiz-sticky"><span id="quiz-progress">Đã trả lời ${answers.filter(answered).length}/50</span><button class="btn btn-primary" data-quiz="submit">Nộp bài</button></div>`;
  }
  async function submit() {
    const missing = answers.findIndex(a => !answered(a));
    if (missing !== -1) { document.getElementById('quiz-q-' + missing).scrollIntoView({ block: 'center' }); throw Error(`Còn ${answers.filter(a => !answered(a)).length} câu chưa trả lời. Vui lòng hoàn thành trước khi nộp.`); }
    if (!confirm('Nộp bài và chấm điểm? Sau khi nộp không thể đổi câu trả lời.')) return;
    const result = await api('/attempts/' + attempt.id + '/submit', { method: 'POST', body: JSON.stringify({ answers }) });
    try { sessionStorage.removeItem('wiki-quiz-' + attempt.id); } catch {}
    attempt = null; renderResult(result); document.getElementById('main').scrollTop = 0;
  }
  function renderResult(r) {
    displayedResult = r;
    root().innerHTML = `<div class="quiz-panel"><p>${esc(r.name)} · ${esc(r.email)}</p><div class="quiz-score">${r.score}/100 — ${esc(r.status)}</div><p>${r.pendingCount ? `Điểm tạm tính · ${r.pendingCount} câu chờ chấm` : `Đúng ${r.correctCount}/50 câu`} · ${new Date(r.submittedAt).toLocaleString('vi-VN')}</p><p class="quiz-meta">Kết quả đã lưu. Success: từ 80 điểm; Failed: dưới 80 điểm.${r.gradedAt ? ` Chấm bởi ${esc(r.gradedBy)} · ${new Date(r.gradedAt).toLocaleString('vi-VN')}` : ''}</p><button class="btn btn-secondary" data-quiz="home">Làm bài mới</button></div><h2>Đáp án & giải thích</h2>${r.questions.map((q, i) => {
      const points = r.points ? r.points[i] : q.correct === r.answers[i] ? 2 : 0;
      return `<div class="quiz-panel quiz-review ${points === null ? 'quiz-pending' : points === 2 ? 'quiz-correct' : 'quiz-wrong'}"><div class="quiz-question-head">${numberTag(i, q)}<span class="quiz-points">${points === null ? 'Chờ chấm' : points + ' điểm'}</span></div>${media(q)}<p>Bạn trả lời: ${esc(['paragraph', 'short'].includes(q.type) ? r.answers[i] : typeof r.answers[i] === 'object' ? q.options[r.answers[i].option] + ': ' + r.answers[i].text : q.options[r.answers[i]])}</p>${q.correct === null ? '<strong>Hướng dẫn chấm thủ công</strong>' : `<p>Đáp án đúng: <strong>${esc(q.options[q.correct])}</strong></p>`}<p>${esc(q.explanation)}</p><a href="#${esc(q.source)}" data-source="${esc(q.source)}">Nguồn: ${esc(sources[q.source] || q.source)}</a>${q.correct === null && meta.canManage ? `<label>Chấm câu trả lời<select data-grade="${esc(q.id)}"><option value="">Chọn đánh giá</option><option value="2" ${points === 2 ? 'selected' : ''}>Đúng · 2 điểm</option><option value="0" ${points === 0 ? 'selected' : ''}>Sai · 0 điểm</option></select></label>` : ''}</div>`;
    }).join('')}${meta.canManage && r.questions.some(q => q.correct === null) ? '<div class="quiz-sticky"><span>Chấm đủ câu cần duyệt để hoàn tất kết quả</span><button class="btn btn-primary" data-quiz="grade">Lưu điểm</button></div>' : ''}`;
  }
  async function saveGrades() {
    const grades = {};
    for (const el of root().querySelectorAll('[data-grade]')) {
      if (el.value === '') throw Error('Vui lòng chấm đủ câu cần duyệt.');
      grades[el.dataset.grade] = Number(el.value);
    }
    renderResult(await api('/results/' + displayedResult.id + '/grade', { method: 'POST', body: JSON.stringify({ grades }) }));
  }
  async function results() {
    const rows = await api('/results'); setActive('results');
    root().innerHTML = `<h2>${meta.canManage ? 'Kết quả nhân viên' : 'Kết quả của tôi'}</h2><p class="quiz-meta">${meta.canManage ? 'Admin và Editor xem toàn bộ các lượt đã nộp, kể cả bài chờ chấm.' : 'Chỉ hiển thị các lượt đã nộp của tài khoản bạn.'}</p>${rows.length ? rows.map(r => `<div class="quiz-panel quiz-result"><div><strong>${esc(r.name)}</strong><div class="quiz-meta">${esc(r.email)}<br>${new Date(r.submittedAt).toLocaleString('vi-VN')}</div></div><strong>${r.score}/100 · ${esc(r.status)}</strong><button class="btn btn-secondary" data-result="${esc(r.id)}">Xem bài làm</button></div>`).join('') : '<p>Chưa có kết quả.</p>'}`;
  }
  function sourceSelect(q, attrs) {
    return `<label>Nguồn wiki<select ${attrs} data-field="source">${Object.entries(sources).map(([id, name]) => `<option value="${id}" ${q.source === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  }
  function questionFields(q, attrs) {
    return `<label>Loại câu hỏi<select ${attrs} data-question-type>${['mc', 'tf', 'paragraph', 'short'].map(t => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${typeName(t)}</option>`).join('')}</select></label><label><input type="checkbox" ${attrs} data-field="enabled" ${q.enabled ? 'checked' : ''}> Đưa vào đề</label><label>Câu hỏi<textarea ${attrs} data-field="prompt" maxlength="2000">${esc(questionText(q))}</textarea></label><div class="quiz-image-editor">${media(q)}<label>Chèn / thay ảnh<input type="file" ${attrs} data-image-upload="true" accept="image/png,image/jpeg,image/webp,image/gif"></label><p class="quiz-meta">PNG, JPG, WebP hoặc GIF · tối đa 10 MB</p><label>Mô tả ảnh<input type="text" ${attrs} data-field="imageAlt" maxlength="200" value="${esc(q.imageAlt)}"></label>${q.image ? `<button class="btn btn-secondary" type="button" ${attrs} data-remove-image="true">Bỏ ảnh</button>` : ''}</div><label>Link sản phẩm tham khảo (không bắt buộc)<input type="url" ${attrs} data-field="productUrl" maxlength="1000" value="${esc(q.productUrl)}" placeholder="https://..."></label>${q.options.map((o, j) => `<label>Lựa chọn ${String.fromCharCode(65 + j)}<input type="text" ${attrs} data-option="${j}" maxlength="500" value="${esc(o)}" ${q.type === 'tf' ? 'disabled' : ''}></label>`).join('')}${['paragraph', 'short'].includes(q.type) ? '<p class="quiz-meta">Câu tự luận được Admin / Editor chấm đúng (2 điểm) hoặc sai (0 điểm).</p>' : `<label>Đáp án đúng<select ${attrs} data-field="correct"><option value="" ${q.correct === null ? 'selected' : ''}>Chấm thủ công — chưa có đáp án chuẩn</option>${q.options.map((o, j) => `<option value="${j}" ${q.correct === j ? 'selected' : ''}>${String.fromCharCode(65 + j)}: ${esc(o)}</option>`).join('')}</select></label>`}<label>${['paragraph', 'short'].includes(q.type) ? 'Đáp án tham khảo / tiêu chí chấm' : 'Giải thích / trích dẫn'}<textarea ${attrs} data-field="explanation" maxlength="3000">${esc(q.explanation)}</textarea></label>${sourceSelect(q, attrs)}`;
  }
  function renderBank() {
    root().innerHTML = `<div class="quiz-bank-heading"><div><h2>Ngân hàng câu hỏi</h2><p id="quiz-bank-totals">${bank.length} câu · ${bank.filter(q => q.type === 'mc').length} trắc nghiệm · ${bank.filter(q => q.type === 'tf').length} đúng/sai · ${bank.filter(q => q.type === 'paragraph').length} tự luận · ${bank.filter(q => q.type === 'short').length} trả lời ngắn</p></div><button class="btn btn-primary" data-quiz="create">Tạo câu hỏi</button></div><p class="quiz-meta">50 câu hỏi lấy từ <a href="https://forms.gle/PKSwfk6NTz7dqw167" target="_blank" rel="noopener noreferrer">form Test SALE/CSKH</a>; đáp án chưa được công khai nên cần chấm thủ công hoặc đặt đáp án chuẩn. Bật “Đưa vào đề” để cho phép rút ngẫu nhiên. Cần chọn đủ 20 trả lời ngắn, 20 trắc nghiệm, 5 tự luận và 5 đúng/sai để tạo đề. Bài đã bắt đầu giữ nguyên câu hỏi và đáp án.</p><div class="quiz-bank-filters"><label>Tìm câu hỏi<input id="quiz-bank-search" type="search" placeholder="Nhập nội dung hoặc mã câu"></label><label>Loại câu hỏi<select id="quiz-bank-type"><option value="">Tất cả loại câu hỏi</option>${['mc', 'tf', 'paragraph', 'short'].map(t => `<option value="${t}">${typeName(t)}</option>`).join('')}</select></label></div><p id="quiz-bank-count" class="quiz-meta" role="status">Hiển thị ${bank.length}/${bank.length} câu</p>${bank.map((q, i) => `<details class="quiz-panel" data-bank-row="${i}"><summary class="quiz-bank-summary"><span class="quiz-number">${String(i + 1).padStart(2, '0')}</span><span class="quiz-summary-copy"><span class="quiz-summary-prompt">${esc(questionText(q))}</span>${q.enabled ? '' : '<span class="quiz-meta">Đã tắt</span>'}</span><span class="quiz-chevron" aria-hidden="true">⌄</span></summary><div class="quiz-question-fields">${questionFields(q, `data-bank="${i}"`)}</div><button type="button" class="btn btn-secondary" data-delete-question="${i}">Xóa câu hỏi</button> <a href="#${esc(q.source)}" data-source="${esc(q.source)}">Đối chiếu nguồn wiki</a></details>`).join('')}<div class="quiz-sticky"><span id="quiz-bank-state">Chưa có thay đổi</span><button class="btn btn-primary" data-quiz="save">Lưu ngân hàng</button></div>`;
  }
  function filterBank() {
    const term = document.getElementById('quiz-bank-search').value.toLocaleLowerCase('vi');
    const type = document.getElementById('quiz-bank-type').value;
    let count = 0;
    root().querySelectorAll('[data-bank-row]').forEach(row => {
      const q = bank[Number(row.dataset.bankRow)];
      row.hidden = !((!type || (changedTypes.get(q.id) || q.type) === type) && (q.id + ' ' + q.prompt).toLocaleLowerCase('vi').includes(term));
      if (!row.hidden) count++;
    });
    document.getElementById('quiz-bank-count').textContent = `Hiển thị ${count}/${bank.length} câu`;
  }
  async function loadBank() {
    const data = await api('/bank'); bank = data.bank; revision = data.revision; changedTypes.clear(); renderBank(); setActive('bank');
  }
  let createTrigger;
  function closeCreate() {
    const dialog = document.getElementById('quiz-create-dialog');
    if (busy) return;
    if (draft && (draft.prompt.trim() || draft.image || draft.explanation.trim()) && !confirm('Bỏ nội dung câu hỏi chưa lưu?')) return;
    dialog?.close();
  }
  function create() {
    if (!meta?.canManage) return;
    createTrigger = document.activeElement;
    draft = { type: 'mc', source: 'bao-gia', enabled: true, prompt: '', options: ['', '', '', ''], correct: 0, explanation: '', image: '', imageAlt: '', productUrl: '' };
    renderCreate();
  }
  function renderCreate() {
    let dialog = document.getElementById('quiz-create-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'quiz-create-dialog';
      dialog.setAttribute('aria-labelledby', 'quiz-dialog-title'); document.body.append(dialog);
      dialog.addEventListener('cancel', e => { e.preventDefault(); closeCreate(); });
      dialog.addEventListener('close', () => { createTrigger?.focus(); });
    }
    dialog.innerHTML = `<div class="quiz-panel quiz-create"><div class="quiz-dialog-heading"><h2 id="quiz-dialog-title">Tạo câu hỏi</h2><button type="button" class="btn btn-secondary" data-close-create aria-label="Đóng tạo câu hỏi">Đóng</button></div><p id="quiz-dialog-error" class="quiz-error" role="alert"></p><p class="quiz-meta">Soạn câu hỏi, chèn hình và đặt đáp án. Câu đã lưu sẽ có trong ngân hàng để chọn vào đề.</p>${questionFields(draft, 'data-draft="true"')}${draft.type === 'mc' ? '<div class="quiz-toolbar"><button class="btn btn-secondary" data-quiz="addOption">Thêm lựa chọn</button><button class="btn btn-secondary" data-quiz="removeOption">Bớt lựa chọn</button></div>' : ''}<button class="btn btn-primary" data-quiz="saveQuestion">Lưu câu hỏi</button><p id="quiz-create-state" role="status"></p></div>`;
    if (!dialog.open) dialog.showModal();
  }
  async function saveQuestion() {
    const data = await api('/questions', { method: 'POST', body: JSON.stringify(draft) });
    draft = null; document.getElementById('quiz-create-dialog').close();
    if (bank && data.revision === revision + 1) { bank.push(data.question); revision = data.revision; }
    if (root().querySelector('[data-bank-row]') && bank && revision === data.revision) {
      renderBank(); document.getElementById('quiz-bank-state').textContent = 'Đã tạo câu hỏi. Các chỉnh sửa khác vẫn cần lưu ngân hàng.';
    } else document.getElementById('quiz-error').textContent = 'Đã tạo câu hỏi trong ngân hàng.';
  }
  async function uploadImage(el) {
    const file = el.files[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('Chọn ảnh PNG, JPG, WebP hoặc GIF không quá 10 MB.');
    const response = await fetch('./api/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'Không tải được ảnh.');
    const q = el.dataset.draft ? draft : bank[Number(el.dataset.bank)]; q.image = data.url; q.imageAlt = file.name.slice(0, 200);
    refreshImageEditor(el, q);
  }
  function refreshImageEditor(el, q) {
    const editor = el.closest('.quiz-image-editor');
    editor.querySelector('figure')?.remove(); editor.querySelector('.quiz-product-link')?.remove();
    editor.insertAdjacentHTML('afterbegin', media(q));
    editor.querySelector('[data-field="imageAlt"]').value = q.imageAlt;
    if (q.image && !editor.querySelector('[data-remove-image]')) {
      const attrs = el.dataset.draft ? 'data-draft="true"' : `data-bank="${el.dataset.bank}"`;
      editor.insertAdjacentHTML('beforeend', `<button class="btn btn-secondary" type="button" ${attrs} data-remove-image="true">Bỏ ảnh</button>`);
    }
    if (el.dataset.bank !== undefined) document.getElementById('quiz-bank-state').textContent = 'Có thay đổi chưa lưu';
  }
  async function save() {
    const data = await api('/bank', { method: 'PUT', body: JSON.stringify({ bank, revision }) }); revision = data.revision;
    const search = document.getElementById('quiz-bank-search').value;
    const targetType = changedTypes.size ? bank.find(q => q.id === [...changedTypes.keys()].at(-1))?.type : document.getElementById('quiz-bank-type').value;
    changedTypes.clear(); renderBank();
    document.getElementById('quiz-bank-search').value = search;
    document.getElementById('quiz-bank-type').value = targetType || '';
    filterBank();
    document.getElementById('quiz-bank-state').textContent = 'Đã lưu ngân hàng';
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'quiz-bank-search') filterBank();
    if (el.dataset.otherAnswer !== undefined) {
      const i = Number(el.dataset.otherAnswer), q = attempt.questions[i];
      root().querySelector(`[data-answer="${i}"][value="${q.otherOption}"]`).checked = true;
      answers[i] = { option: q.otherOption, text: el.value };
      document.getElementById('quiz-progress').textContent = `Đã trả lời ${answers.filter(answered).length}/50`;
      try { sessionStorage.setItem('wiki-quiz-' + attempt.id, JSON.stringify(answers)); } catch {}
    }
    if (el.dataset.answer !== undefined) {
      answers[Number(el.dataset.answer)] = el.dataset.paragraph ? el.value : Number(el.value);
      const q = attempt.questions[Number(el.dataset.answer)];
      if (!el.dataset.paragraph && Number(el.value) === q.otherOption) answers[Number(el.dataset.answer)] = { option: q.otherOption, text: root().querySelector(`[data-other-answer="${el.dataset.answer}"]`).value };
      try { sessionStorage.setItem('wiki-quiz-' + attempt.id, JSON.stringify(answers)); } catch {}
      document.getElementById('quiz-progress').textContent = `Đã trả lời ${answers.filter(answered).length}/50`;
    }
    if ((el.dataset.bank !== undefined || el.dataset.draft) && !el.dataset.imageUpload && !el.dataset.removeImage && !el.hasAttribute('data-question-type')) {
      const q = el.dataset.draft ? draft : bank[Number(el.dataset.bank)];
      if (el.dataset.option !== undefined) {
        q.options[Number(el.dataset.option)] = el.value;
        const select = el.closest('details, .quiz-create').querySelector('select[data-field="correct"]');
        [...select.options].forEach(option => { if (option.value !== '') option.textContent = `Lựa chọn ${Number(option.value) + 1}: ${q.options[Number(option.value)]}`; });
      } else q[el.dataset.field] = el.dataset.field === 'enabled' ? el.checked : el.dataset.field === 'correct' ? (el.value === '' ? null : Number(el.value)) : el.value;
      if (!el.dataset.draft) document.getElementById('quiz-bank-state').textContent = 'Có thay đổi chưa lưu';
    }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.id === 'quiz-bank-type') filterBank();
    if (el.hasAttribute('data-question-type')) {
      const q = el.dataset.draft ? draft : bank[Number(el.dataset.bank)];
      if (q.type === el.value) return;
      if (!el.dataset.draft && !changedTypes.has(q.id)) changedTypes.set(q.id, q.type);
      q.type = el.value;
      q.options = q.type === 'tf' ? ['Đúng', 'Sai'] : q.type === 'mc' ? ['', '', '', ''] : [];
      q.correct = null;
      delete q.otherOption;
      if (el.dataset.draft) renderCreate();
      else {
        const row = el.closest('details');
        row.querySelector('.quiz-question-fields').innerHTML = questionFields(q, `data-bank="${el.dataset.bank}"`);
        document.getElementById('quiz-bank-state').textContent = 'Có thay đổi chưa lưu';
        document.getElementById('quiz-bank-totals').textContent = `${bank.length} câu · ` + ['mc', 'tf', 'paragraph', 'short'].map(t => `${bank.filter(q => q.type === t).length} ${typeName(t).toLowerCase()}`).join(' · ');
        filterBank();
      }
    }
    if (el.dataset.imageUpload) {
      busy = true; el.disabled = true;
      document.querySelectorAll('#quiz-content button, #quiz-create-dialog button').forEach(button => button.disabled = true);
      try { await uploadImage(el); } catch (e) { error(e); }
      finally { busy = false; el.disabled = false; document.querySelectorAll('#quiz-content button, #quiz-create-dialog button').forEach(button => button.disabled = false); }
    }
  });
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-close-create]')) { closeCreate(); return; }
    const el = e.target.closest('[data-quiz], [data-result], [data-source], [data-remove-image], [data-delete-question]');
    if (!el || busy) return;
    if (el.dataset.removeImage) { const q = el.dataset.draft ? draft : bank[Number(el.dataset.bank)]; q.image = ''; q.imageAlt = ''; refreshImageEditor(el, q); el.remove(); return; }
    if (el.dataset.source) { e.preventDefault(); navigate(el.dataset.source); return; }
    busy = true; el.disabled = true; document.getElementById('quiz-error').textContent = '';
    try {
      if (el.dataset.deleteQuestion !== undefined) {
        const q = bank[Number(el.dataset.deleteQuestion)];
        if (!confirm('Xóa câu hỏi này khỏi ngân hàng? Bài đã bắt đầu và kết quả đã nộp vẫn giữ bản cũ.')) return;
        const data = await api('/questions/' + encodeURIComponent(q.id), { method: 'DELETE', body: JSON.stringify({ revision }) });
        const type = document.getElementById('quiz-bank-type').value, search = document.getElementById('quiz-bank-search').value;
        bank = bank.filter(x => x.id !== q.id); revision = data.revision; changedTypes.delete(q.id); renderBank();
        document.getElementById('quiz-bank-type').value = type; document.getElementById('quiz-bank-search').value = search; filterBank();
        document.getElementById('quiz-bank-state').textContent = 'Đã xóa câu hỏi. Các chỉnh sửa khác vẫn cần lưu.';
      }
      else if (el.dataset.result) renderResult(await api('/results/' + el.dataset.result));
      else await ({ home: load, start, restart, submit, results, bank: loadBank, save, create, saveQuestion, grade: saveGrades, addOption: () => { if (draft.options.length >= 8) throw Error('Tối đa 8 lựa chọn.'); draft.options.push(''); renderCreate(); }, removeOption: () => { if (draft.options.length <= 2) throw Error('Cần ít nhất 2 lựa chọn.'); draft.options.pop(); draft.correct = draft.correct === null ? null : Math.min(draft.correct, draft.options.length - 1); renderCreate(); } }[el.dataset.quiz])();
    } catch (e) { error(e); }
    finally { busy = false; el.disabled = false; }
  });
  return { load };
})();
