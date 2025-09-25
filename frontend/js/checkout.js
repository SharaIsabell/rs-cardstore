(function () {
  const radios = document.querySelectorAll('input[name="metodo"]');
  const card = document.getElementById('card-fields');
  const pix = document.getElementById('pix-fields');
  const qrcodeEl = document.getElementById('qrcode');
  const payloadEl = document.getElementById('pix_payload');
  const btnCopy = document.getElementById('btnCopy');

  function ensurePixPayload() {
    if (!payloadEl) return '';
    if (payloadEl.value) return payloadEl.value;
    const base = `PIX|chave=${window.__PIX_CHAVE__ || 'chave@exemplo.com'}|txid=${Date.now()}`;
    payloadEl.value = base;
    return base;
  }

  function renderQR() {
    if (!qrcodeEl) return;
    qrcodeEl.innerHTML = '';
    const text = ensurePixPayload();
    if (window.QRCode) {
      new QRCode(qrcodeEl, { text, width: 180, height: 180 });
    } else {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'QR indisponível. Use o código abaixo:';
      qrcodeEl.appendChild(p);
    }
  }

  function updateUI() {
    const val = document.querySelector('input[name="metodo"]:checked')?.value;
    if (!val) return;
    const showCard = (val === 'cartao_credito' || val === 'cartao_debito');
    card && (card.style.display = showCard ? 'block' : 'none');
    pix && (pix.style.display = (val === 'pix') ? 'block' : 'none');
    if (val === 'pix') renderQR();
  }

  radios.forEach(r => r.addEventListener('change', updateUI));
  updateUI();

  // máscaras
  const ccNum = document.getElementById('cc_number');
  const ccExp = document.getElementById('cc_exp');
  const ccCvv = document.getElementById('cc_cvv');

  ccNum && ccNum.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,19).replace(/(.{4})/g,'$1 ').trim();
  });
  ccExp && ccExp.addEventListener('input', e => {
    let v = e.target.value.replace(/\D/g,'').slice(0,4);
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    e.target.value = v;
  });
  ccCvv && ccCvv.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,4);
  });

  btnCopy && btnCopy.addEventListener('click', async () => {
    try {
      ensurePixPayload();
      await navigator.clipboard.writeText(payloadEl.value);
      btnCopy.textContent = 'Copiado!';
      setTimeout(() => btnCopy.textContent = 'Copiar código', 1500);
    } catch {
      alert('Não foi possível copiar. Selecione e copie manualmente.');
    }
  });

  // pré-seleção
  const pagamento = window.__PAGAMENTO__;
  if (pagamento && pagamento.metodo) {
    const pre = document.querySelector(`input[name="metodo"][value="${pagamento.metodo}"]`);
    if (pre) { pre.checked = true; updateUI(); }
    if (pagamento.metodo === 'pix' && pagamento.pix && pagamento.pix.payload) {
      payloadEl.value = pagamento.pix.payload;
      renderQR();
    }
  }
})();