// 1. Imports - Added 'updateProfile' so the name follows the UID
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    updateProfile 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";    

import { 
    getDatabase, 
    ref, 
    set 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";  

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

const db = getDatabase(app);

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

// 7. Scroll to login
const toLoginPage = document.getElementById("go-to-login");
if (toLoginPage) toLoginPage.onclick = toggleAuth;

function toggleAuth() {
    const container = document.querySelector(".login-container");
    container.scrollIntoView({ behavior: 'smooth' });
}

// 8. Toast (Updated for Top Position)
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

// 10. Firebase Auth (Updated with updateProfile for the name)
const signUpUser = (email, password, fullName) => {
    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            const user = userCredential.user;

            return updateProfile(user, {
                displayName: fullName
            }).then(() => {

                const role = getCurrentRole();

                if (role === "driver") {
                    return set(ref(db, 'drivers/' + user.uid), {
                        name: fullName,
                        email: email,
                        phone: "",
                        driverKey: document.getElementById("driver-key").value,
                        assignedBusId: null,
                        isVerified: false
                    });
                } else {
                    // ✅ STUDENT DATA
                    return set(ref(db, 'students/' + user.uid), {
                        name: fullName,
                        email: email,
                        phone: "",
                        class: "",
                        parentName: "",
                        location: "",
                        assignedBusId: null
                    });
                }
            });
        })
        .then(() => {
            showToast("Registered Successfully!");
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

// 11. Form submit — Handles the Full Name input correctly
authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email    = document.getElementById("user-email").value.trim();
    const password = passInput.value;
    const fullName = document.getElementById("user-name").value.trim();

    if (!email || !password) {
        showToast("Please fill in all fields.", true);
        return;
    }

    if (signupTabBtn.classList.contains("active")) {
        if (!fullName) {
            showToast("Please enter your name.", true);
            return;
        }
        if (driverToggle.classList.contains("active")) {
            const driverKey = document.getElementById("driver-key").value.trim();
            if (!driverKey || driverKey.length !== 6) {
                showToast("Please enter a valid 6-digit driver key.", true);
                return;
            }
            // Simple fixed key check — replace with your real key
            if (driverKey !== "BUS123") {
                showToast("Invalid driver authorization key.", true);
                return;
            }
        }
        signUpUser(email, password, fullName);
    } else {
        loginUser(email, password);
    }
});

// 12. Init defaults
setUserType('passenger');
switchAuthTab('login');
