/* Quiz uses the wiki's existing dashboard identity and Admin role. */
const Quiz = (() => {
  let meta, attempt, answers = [], bank, revision, busy = false;
  const root = () => document.getElementById('quiz-content');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sources = { 'cach-lam-viec': 'Cách làm việc', 'bao-gia': 'Tư vấn & Báo giá', 'tao-don': 'Follow đơn', 'bao-hang-ve': 'Báo hàng về', 'hang-stock': 'Hàng stock', faq: 'FAQ', 'thuat-ngu': 'Thuật ngữ', 'noi-quy': 'Nội quy chung' };
  async function api(url = '', options = {}) {
    const response = await fetch(apiUrl('./api/quiz' + url), { ...options, headers: { 'Content-Type': 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Không thực hiện được yêu cầu.');
    return data;
  }
  function error(e) { document.getElementById('quiz-error').textContent = e.message; }
  function toolbar() {
    document.getElementById('quiz-error').textContent = '';
    document.getElementById('quiz-tools').innerHTML = `<button class="btn btn-secondary" data-quiz="home">Làm bài</button><button class="btn btn-secondary" data-quiz="results">${meta.isAdmin ? 'Kết quả nhân viên' : 'Kết quả của tôi'}</button>${meta.isAdmin ? '<button class="btn btn-secondary" data-quiz="bank">Ngân hàng câu hỏi</button>' : ''}`;
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
        root().innerHTML = `<div class="quiz-panel"><h2>Kiểm tra kiến thức quy trình</h2><p>Mỗi lượt gồm <strong>50 câu ngẫu nhiên</strong>: 35 trắc nghiệm và 15 đúng/sai. Mỗi câu đúng được 2 điểm, tổng 100 điểm.</p><p><strong>Success: từ 80 điểm · Failed: dưới 80 điểm.</strong></p><p class="quiz-meta">Không giới hạn thời gian. Trả lời đủ 50 câu để nộp. Kết quả lưu cho bạn và Admin; sau khi nộp có thể xem đáp án và nguồn wiki.</p><p class="quiz-meta">Tài khoản: ${esc(meta.email)} · Đang chọn ${meta.available.mc} câu trắc nghiệm / ${meta.available.tf} câu đúng/sai.</p><label>Họ tên nhân viên<input id="quiz-name" type="text" maxlength="120" autocomplete="name" placeholder="Nhập họ và tên"></label><button class="btn btn-primary" data-quiz="start">Bắt đầu làm bài</button></div>`;
      }
    } catch (e) { root().innerHTML = ''; error(e); }
  }
  async function start() {
    const name = document.getElementById('quiz-name').value.trim();
    if (!name) throw Error('Vui lòng nhập họ tên.');
    attempt = await api('/attempts', { method: 'POST', body: JSON.stringify({ name }) });
    answers = Array(50).fill(null); renderAttempt();
  }
  function renderAttempt() {
    root().innerHTML = `<p class="quiz-meta">${esc(attempt.name)} · 50 câu · 2 điểm/câu. Đề được giữ nguyên nếu quay lại trang.</p>${attempt.questions.map((q, i) => `<fieldset class="quiz-panel" id="quiz-q-${i}"><legend>Câu ${i + 1} · ${q.type === 'mc' ? 'Trắc nghiệm' : 'Đúng / Sai'}</legend><strong>${esc(q.prompt)}</strong>${q.options.map((o, j) => `<label class="quiz-choice"><input type="radio" name="quiz-answer-${i}" data-answer="${i}" value="${j}" ${answers[i] === j ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('')}<div class="quiz-sticky"><span id="quiz-progress">Đã trả lời ${answers.filter(a => a !== null).length}/50</span><button class="btn btn-primary" data-quiz="submit">Nộp bài</button></div>`;
  }
  async function submit() {
    const missing = answers.findIndex(a => a === null);
    if (missing !== -1) { document.getElementById('quiz-q-' + missing).scrollIntoView({ block: 'center' }); throw Error(`Còn ${answers.filter(a => a === null).length} câu chưa trả lời. Vui lòng hoàn thành trước khi nộp.`); }
    if (!confirm('Nộp bài và chấm điểm? Sau khi nộp không thể đổi câu trả lời.')) return;
    const result = await api('/attempts/' + attempt.id + '/submit', { method: 'POST', body: JSON.stringify({ answers }) });
    try { sessionStorage.removeItem('wiki-quiz-' + attempt.id); } catch {}
    attempt = null; renderResult(result); document.getElementById('main').scrollTop = 0;
  }
  function renderResult(r) {
    root().innerHTML = `<div class="quiz-panel"><p>${esc(r.name)} · ${esc(r.email)}</p><div class="quiz-score">${r.score}/100 — ${esc(r.status)}</div><p>Đúng ${r.correctCount}/50 câu · ${new Date(r.submittedAt).toLocaleString('vi-VN')}</p><p class="quiz-meta">Kết quả đã lưu. Success: từ 80 điểm; Failed: dưới 80 điểm.</p><button class="btn btn-secondary" data-quiz="home">Làm bài mới</button></div><h2>Đáp án & giải thích</h2>${r.questions.map((q, i) => `<div class="quiz-panel quiz-review ${q.correct === r.answers[i] ? 'quiz-correct' : 'quiz-wrong'}"><strong>Câu ${i + 1}. ${esc(q.prompt)}</strong><p>${q.correct === r.answers[i] ? 'Đúng · 2 điểm' : 'Sai · 0 điểm'} — Bạn chọn: ${esc(q.options[r.answers[i]])}</p><p>Đáp án đúng: <strong>${esc(q.options[q.correct])}</strong></p><p>${esc(q.explanation)}</p><a href="#${esc(q.source)}" data-source="${esc(q.source)}">Nguồn: ${esc(sources[q.source] || q.source)}</a></div>`).join('')}`;
  }
  async function results() {
    const rows = await api('/results');
    root().innerHTML = `<h2>${meta.isAdmin ? 'Kết quả nhân viên' : 'Kết quả của tôi'}</h2><p class="quiz-meta">${meta.isAdmin ? 'Admin xem toàn bộ các lượt đã nộp.' : 'Chỉ hiển thị các lượt đã nộp của tài khoản bạn.'}</p>${rows.length ? rows.map(r => `<div class="quiz-panel quiz-result"><div><strong>${esc(r.name)}</strong><div class="quiz-meta">${esc(r.email)}<br>${new Date(r.submittedAt).toLocaleString('vi-VN')}</div></div><strong>${r.score}/100 · ${esc(r.status)}</strong><button class="btn btn-secondary" data-result="${esc(r.id)}">Xem bài làm</button></div>`).join('') : '<p>Chưa có kết quả.</p>'}`;
  }
  async function loadBank() {
    const data = await api('/bank'); bank = data.bank; revision = data.revision;
    root().innerHTML = `<h2>Ngân hàng 100 câu hỏi</h2><p>70 trắc nghiệm · 30 đúng/sai. Bật “Đưa vào đề” để chọn câu được phép rút ngẫu nhiên. Cần ít nhất 35 trắc nghiệm và 15 đúng/sai.</p><p class="quiz-meta">Câu hỏi được soạn từ wiki và kèm trích dẫn. Admin có thể đối chiếu nguồn, sửa câu hỏi, lựa chọn, đáp án và giải thích. Thay đổi chỉ áp dụng cho lượt bắt đầu sau khi lưu.</p><label>Tìm câu hỏi<input id="quiz-bank-search" type="text" placeholder="Nhập nội dung hoặc mã câu" style="width:100%;padding:10px"></label>${bank.map((q, i) => `<details class="quiz-panel" data-bank-row="${i}"><summary class="quiz-bank-summary">${esc(q.id)} · ${q.type === 'mc' ? 'Trắc nghiệm' : 'Đúng/sai'} · ${esc(q.prompt)}</summary><label><input type="checkbox" data-bank="${i}" data-field="enabled" ${q.enabled ? 'checked' : ''}> Đưa vào đề</label><label>Câu hỏi<textarea data-bank="${i}" data-field="prompt" maxlength="1000">${esc(q.prompt)}</textarea></label>${q.options.map((o, j) => `<label>Lựa chọn ${j + 1}<input type="text" data-bank="${i}" data-option="${j}" maxlength="500" value="${esc(o)}" ${q.type === 'tf' ? 'disabled' : ''}></label>`).join('')}<label>Đáp án đúng<select data-bank="${i}" data-field="correct">${q.options.map((o, j) => `<option value="${j}" ${q.correct === j ? 'selected' : ''}>Lựa chọn ${j + 1}: ${esc(o)}</option>`).join('')}</select></label><label>Giải thích / trích dẫn<textarea data-bank="${i}" data-field="explanation" maxlength="3000">${esc(q.explanation)}</textarea></label><label>Nguồn wiki<select data-bank="${i}" data-field="source">${Object.entries(sources).map(([id, name]) => `<option value="${id}" ${q.source === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label><a href="#${esc(q.source)}" data-source="${esc(q.source)}">Đối chiếu nguồn wiki</a></details>`).join('')}<div class="quiz-sticky"><span id="quiz-bank-state">Chưa có thay đổi</span><button class="btn btn-primary" data-quiz="save">Lưu ngân hàng</button></div>`;
  }
  async function save() {
    const data = await api('/bank', { method: 'PUT', body: JSON.stringify({ bank, revision }) }); revision = data.revision;
    document.getElementById('quiz-bank-state').textContent = 'Đã lưu ngân hàng';
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'quiz-bank-search') {
      const term = el.value.toLocaleLowerCase('vi');
      root().querySelectorAll('[data-bank-row]').forEach(row => { const q = bank[Number(row.dataset.bankRow)]; row.hidden = !(q.id + ' ' + q.prompt).toLocaleLowerCase('vi').includes(term); });
    }
    if (el.dataset.answer !== undefined) {
      answers[Number(el.dataset.answer)] = Number(el.value);
      try { sessionStorage.setItem('wiki-quiz-' + attempt.id, JSON.stringify(answers)); } catch {}
      document.getElementById('quiz-progress').textContent = `Đã trả lời ${answers.filter(a => a !== null).length}/50`;
    }
    if (el.dataset.bank !== undefined) {
      const q = bank[Number(el.dataset.bank)];
      if (el.dataset.option !== undefined) {
        q.options[Number(el.dataset.option)] = el.value;
        const select = el.closest('details').querySelector('select[data-field="correct"]');
        [...select.options].forEach((option, i) => { option.textContent = `Lựa chọn ${i + 1}: ${q.options[i]}`; });
      } else q[el.dataset.field] = el.dataset.field === 'enabled' ? el.checked : el.dataset.field === 'correct' ? Number(el.value) : el.value;
      document.getElementById('quiz-bank-state').textContent = 'Có thay đổi chưa lưu';
    }
  });
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-quiz], [data-result], [data-source]');
    if (!el || busy) return;
    if (el.dataset.source) { e.preventDefault(); navigate(el.dataset.source); return; }
    busy = true; el.disabled = true; document.getElementById('quiz-error').textContent = '';
    try {
      if (el.dataset.result) renderResult(await api('/results/' + el.dataset.result));
      else await ({ home: load, start, submit, results, bank: loadBank, save }[el.dataset.quiz])();
    } catch (e) { error(e); }
    finally { busy = false; el.disabled = false; }
  });
  return { load };
})();
