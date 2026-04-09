// 1. Imports MUST be at the top
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";    

// 2. Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSy...", 
    authDomain: "bus-tracker-app-001.firebaseapp.com",
    projectId: "bus-tracker-app-001",
    appId: "1:183488595656:web:5e0f1cf3ca1601e08bc7fd"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// 3. Select Elements once
const seePass = document.getElementById("see-pass");
const passInput = document.getElementById("password");
const loginTabBtn = document.getElementById("login-tab-btn");
const signupTabBtn = document.getElementById("signup-tab-btn");
const driverToggle = document.getElementById("driver-toggle");
const passengerToggle = document.getElementById("passenger-toggle");
const authForm = document.getElementById("auth-form");

// 4. Toggles
seePass.addEventListener("click", () => {
    const isPass = passInput.type === "password";
    passInput.type = isPass ? "text" : "password";
    seePass.classList.toggle("fa-eye");
    seePass.classList.toggle("fa-eye-slash");
});

loginTabBtn.addEventListener("click", () => switchAuthTab('login'));
signupTabBtn.addEventListener("click", () => switchAuthTab('signup'));

function switchAuthTab(type) {
    const nameGroup = document.getElementById("name-group");
    const title = document.getElementById("form-title");
    const submitBtn = document.getElementById("submit-btn");
    const forgotLink = document.getElementById("forgot-pass-link");

    if (type === 'signup') {
        signupTabBtn.classList.add("active");
        loginTabBtn.classList.remove("active");
        nameGroup.style.display = "flex";
        title.innerText = "Create Account";
        submitBtn.innerText = "Register Now";
        forgotLink.style.display = "none";
    } else {
        loginTabBtn.classList.add("active");
        signupTabBtn.classList.remove("active");
        nameGroup.style.display = "none";
        title.innerText = "Welcome Back";
        submitBtn.innerText = "Login";
        forgotLink.style.display = "block";
    }
}

driverToggle.addEventListener("click", () => setUserType('driver'));
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

const toLoginPage = document.getElementById("go-to-login");
if(toLoginPage) toLoginPage.onclick = toggleAuth; 

function toggleAuth() {
    const container = document.querySelector(".login-container");
    container.scrollIntoView({ behavior: 'smooth' });
    container.style.boxShadow = "0 0 20px rgba(255, 193, 7, 0.4)";
    setTimeout(() => {
        container.style.boxShadow = "0 20px 40px rgba(0, 0, 0, 0.1)";
    }, 1000);
}

// 5. Toast Notification Helper
function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.background = isError ? "#e74c3c" : "#2ecc71";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

// 6. Role-based Redirect
function getCurrentRole() {
    return driverToggle.classList.contains("active") ? "driver" : "passenger";
}

function redirectByRole() {
    const role = getCurrentRole();
    if (role === "driver") {
        window.location.href = "driver.html";
    } else {
        window.location.href = "student.html";
    }
}

// 7. FIREBASE AUTH LOGIC
const signUpUser = (email, password) => {
    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            showToast("Welcome to BusTrack!");
            redirectByRole();
        })
        .catch((error) => {
            showToast(error.message, true);
        });
};

const loginUser = (email, password) => {
    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            showToast("Logged in successfully!");
            redirectByRole();
        })
        .catch((error) => {
            showToast("Login failed: " + error.message, true);
        });
};

// 8. Form Submission Listener
authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = authForm.querySelector('input[type="text"]').value;
    const password = passInput.value;
    
    if (signupTabBtn.classList.contains("active")) {
        signUpUser(email, password);
    } else {
        loginUser(email, password);
    }
});

// Init
setUserType('passenger');
switchAuthTab('login');