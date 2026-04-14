// ── Hamburger / Mobile Drawer ──────────────────────────────────────────
const ham     = document.getElementById('ham');
const drawer  = document.getElementById('mobileDrawer');
const overlay = document.getElementById('overlay');

if (ham && drawer && overlay) {
  function toggleMenu(open) {
    drawer.classList.toggle('open', open);
    ham.classList.toggle('open', open);
    overlay.classList.toggle('active', open);
    ham.setAttribute('aria-expanded', open);
  }

  ham.addEventListener('click', () => toggleMenu(!drawer.classList.contains('open')));
  overlay.addEventListener('click', () => toggleMenu(false));

  drawer.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => toggleMenu(false))
  );
}

// ── Scroll Reveal ──────────────────────────────────────────────────────
const reveals = document.querySelectorAll('.reveal');
if (reveals.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.12 });
  reveals.forEach(el => observer.observe(el));
}

// ── Contact Form (index.html only) ────────────────────────────────────
const sendBtn = document.getElementById('sendBtn');
if (sendBtn) {
  sendBtn.addEventListener('click', () => {
    const fname   = document.getElementById('fname').value.trim();
    const email   = document.getElementById('email').value.trim();
    const message = document.getElementById('message').value.trim();

    if (!fname || !email || !message) {
      alert('Please fill in your name, email, and message.');
      return;
    }

    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = "Message sent! We'll get back to you within 24 hours.";
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    }

    ['fname', 'lname', 'email', 'message'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const subject = document.getElementById('subject');
    if (subject) subject.selectedIndex = 0;
  });
}