const ham = document.getElementById('ham');
const drawer = document.getElementById('mobileDrawer');
const overlay = document.getElementById('overlay');

function toggleMenu(open) {
  drawer.classList.toggle('open', open);
  ham.classList.toggle('open', open);
  overlay.classList.toggle('active', open);
  ham.setAttribute('aria-expanded', open);
}

ham.addEventListener('click', () => toggleMenu(!drawer.classList.contains('open')));
overlay.addEventListener('click', () => toggleMenu(false));

// close on nav link click
drawer.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => toggleMenu(false))
);


// ── Scroll Reveal ──
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.12 });
reveals.forEach(el => observer.observe(el));

// ── Contact Form ──
document.getElementById('sendBtn').addEventListener('click', () => {
  const fname = document.getElementById('fname').value.trim();
  const email = document.getElementById('email').value.trim();
  const message = document.getElementById('message').value.trim();

  if (!fname || !email || !message) {
    alert('Please fill in your name, email, and message.');
    return;
  }

  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);

  // Reset form
  ['fname','lname','email','message'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('subject').selectedIndex = 0;
});