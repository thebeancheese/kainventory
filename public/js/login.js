
const loginForm = document.querySelector('#loginForm');
const loginBtn = document.querySelector('#loginBtn');
const loginError = document.querySelector('#loginError');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (loginBtn.disabled) return;

  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: loginForm.elements.namedItem('username').value,
        password: loginForm.elements.namedItem('password').value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed.');
    }

    window.location.href = 'restaurants.html';
  } catch (error) {
    loginError.textContent = error.message || 'Could not log in.';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
});
