// 1. Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";    

// 2. Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyCVTQr4SePTDMHe2H7VYKvDmvD0e71JpPg",
    authDomain: "bus-tracker-app-001.firebaseapp.com",
    databaseURL: "https://bus-tracker-app-001-default-rtdb.firebaseio.com",
    projectId: "bus-tracker-app-001",
    storageBucket: "bus-tracker-app-001.firebasestorage.app",
    messagingSenderId: "183488595656",
    appId: "1:183488595656:web:5e0f1cf3ca1601e08bc7fd"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// 3. Select Elements
const seePass         = document.getElementById("see-pass");
const passInput       = document.getElementById("password");
const loginTabBtn     = document.getElementById("login-tab-btn");
const signupTabBtn    = document.getElementById("signup-tab-btn");
const driverToggle    = document.getElementById("driver-toggle");
const passengerToggle = document.getElementById("passenger-toggle");
const authForm        = document.getElementById("auth-form");

// 4. Show / hide password
seePass.addEventListener("click", () => {
    const isPass = passInput.type === "password";
    passInput.type = isPass ? "text" : "password";
    seePass.classList.toggle("fa-eye");
    seePass.classList.toggle("fa-eye-slash");
});

// 5. Login / Signup tab switch
loginTabBtn.addEventListener("click",  () => switchAuthTab('login'));
signupTabBtn.addEventListener("click", () => switchAuthTab('signup'));

function switchAuthTab(type) {
    const nameGroup  = document.getElementById("name-group");
    const title      = document.getElementById("form-title");
    const submitBtn  = document.getElementById("submit-btn");
    const forgotLink = document.getElementById("forgot-pass-link");

    if (type === 'signup') {
        signupTabBtn.classList.add("active");
        loginTabBtn.classList.remove("active");
        nameGroup.style.display  = "flex";
        title.innerText          = "Create Account";
        submitBtn.innerText      = "Register Now";
        forgotLink.style.display = "none";
    } else {
        loginTabBtn.classList.add("active");
        signupTabBtn.classList.remove("active");
        nameGroup.style.display  = "none";
        title.innerText          = "Welcome Back";
        submitBtn.innerText      = "Login";
        forgotLink.style.display = "block";
    }
}

// 6. Driver / Passenger toggle
driverToggle.addEventListener("click",    () => setUserType('driver'));
passengerToggle.addEventListener("click", () => setUserType('passenger'));

function setUserType(role) {
    const driverKeyGroup = document.getElementById("driver-key-group");
    if (role === 'driver') {
        driverToggle.classList.add("active");
        passengerToggle.classList.remove("active");
        driverKeyGroup.style.display = "flex";
    } else {
        passengerToggle.classList.add("active");
        driverToggle.classList.remove("active");
        driverKeyGroup.style.display = "none";
    }
}

// 7. Scroll to login on nav button click
const toLoginPage = document.getElementById("go-to-login");
if (toLoginPage) toLoginPage.onclick = toggleAuth;

function toggleAuth() {
    const container = document.querySelector(".login-container");
    container.scrollIntoView({ behavior: 'smooth' });
    container.style.boxShadow = "0 0 20px rgba(255, 193, 7, 0.4)";
    setTimeout(() => {
        container.style.boxShadow = "0 20px 40px rgba(0, 0, 0, 0.1)";
    }, 1000);
}

// 8. Toast
function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent      = message;
    toast.style.background = isError ? "#e74c3c" : "#2ecc71";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

// 9. Role-based redirect
function getCurrentRole() {
    return driverToggle.classList.contains("active") ? "driver" : "passenger";
}

function redirectByRole() {
    const role = getCurrentRole();
    window.location.href = role === "driver" ? "driver.html" : "student.html";
}

// 10. Firebase Auth
const signUpUser = (email, password) => {
    createUserWithEmailAndPassword(auth, email, password)
        .then(() => {
            showToast("Welcome to BusTrack!");
            setTimeout(redirectByRole, 1000);
        })
        .catch((error) => {
            showToast(error.message, true);
        });
};

const loginUser = (email, password) => {
    signInWithEmailAndPassword(auth, email, password)
        .then(() => {
            showToast("Logged in successfully!");
            setTimeout(redirectByRole, 1000);
        })
        .catch((error) => {
            showToast("Login failed: " + error.message, true);
        });
};

// 11. Form submit — uses id="user-email" with .trim() to avoid invalid-email errors
authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email    = document.getElementById("user-email").value.trim();
    const password = passInput.value;

    if (!email || !password) {
        showToast("Please fill in all fields.", true);
        return;
    }

    if (signupTabBtn.classList.contains("active")) {
        signUpUser(email, password);
    } else {
        loginUser(email, password);
    }
});

// 12. Init defaults
setUserType('passenger');
switchAuthTab('login');