import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc, // Corrected to just setDoc
} from "firebase/firestore";

// IMPORTANT: Paste YOUR ACTUAL Firebase project config JSON here.
// Get this from Firebase Console -> Project settings -> Your apps -> Web app -> Config
const firebaseConfig = {
  apiKey: "AIzaSyAbVWMbQaRktuNbEs39oqK_fLW01IwZcYg",
  authDomain: "kyau-results-live.firebaseapp.com",
  projectId: "kyau-results-live",
  storageBucket: "kyau-results-live.firebasestorage.app",
  messagingSenderId: "662960795243",
  appId: "1:662960795243:web:0f8705c2cbd6c89ac64b2e",
  measurementId: "G-V785DV14BC",
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Get the projectId from the firebaseConfig for consistency in Firestore paths
const currentAppId = firebaseConfig.projectId;

// IMPORTANT: REPLACE THIS WITH THE EXACT EMAIL OF YOUR ADMIN USER CREATED IN FIREBASE AUTHENTICATION
const ADMIN_EMAIL = "sanjid.cse16@gmail.com"; // <-- !! REPLACE THIS EMAIL !!

// Main App Component
const App = () => {
  const [studentIdInput, setStudentIdInput] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Admin Login/Logout States
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // States for Data Management Modals
  const [showImportCSVModal, setShowImportCSVModal] = useState(false);
  const [showManualAddModal, setShowManualAddModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  // State for Manual Student Data Entry
  const [manualStudentData, setManualStudentData] = useState({
    studentId: "",
    name: "",
    department: "",
    session: "",
    batch: "",
    cgpa: "",
    courseResults: [{ courseCode: "", grade: "" }],
  });

  // Effect for Firebase Authentication State Changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log("Firebase Auth Debug: onAuthStateChanged fired. User:", user);
      if (user) {
        setUserId(user.uid);
        const userIsAdmin = user.email === ADMIN_EMAIL;
        setIsAdmin(userIsAdmin);
        console.log(
          "Firebase Auth Debug: User email:",
          user.email,
          "Is Admin:",
          userIsAdmin,
          "Expected ADMIN_EMAIL:",
          ADMIN_EMAIL
        );
      } else {
        // If no user is authenticated, ensure an anonymous session is active for public search
        // Also, explicitly sign out if there's any previous lingering session
        try {
          if (auth.currentUser) {
            await signOut(auth); // Ensure a clean sign out
            console.log("Firebase Auth Debug: Signed out previous user.");
          }
          await signInAnonymously(auth);
          setUserId(auth.currentUser?.uid || null);
          setIsAdmin(false);
          console.log(
            "Firebase Auth Debug: Signed in anonymously. User ID:",
            auth.currentUser?.uid
          );
        } catch (authError) {
          console.error("Firebase anonymous authentication error:", authError);
          setError("Failed to initialize authentication. Please try again.");
        }
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // Function to determine remarks based on CGPA and grades
  const getRemarksByCGPA = (cgpa, courseResults) => {
    const cgpaValue = parseFloat(cgpa);
    if (isNaN(cgpaValue)) return "N/A";

    // Check for explicit 'F' or 'Absent' grades in course results
    const hasFailingGrade = courseResults.some(
      (course) =>
        (typeof course.grade === "string" &&
          course.grade.toUpperCase() === "F") ||
        (typeof course.grade === "string" &&
          course.grade.toUpperCase() === "ABSENT")
    );

    if (hasFailingGrade) {
      return "Needs Improvement (Failing grade or Absent)";
    }

    // Determine remark based on CGPA thresholds
    if (cgpaValue >= 3.75) {
      return "Outstanding Performance";
    } else if (cgpaValue >= 3.5) {
      return "Excellent Academic Standing";
    } else if (cgpaValue >= 3.0) {
      return "Good Academic Progress";
    } else if (cgpaValue >= 2.5) {
      return "Satisfactory Performance";
    } else {
      return "Needs Improvement";
    }
  };

  // Function to handle student result search
  const searchResults = async (e) => {
    e.preventDefault();
    if (!authReady) {
      setError("Authentication not ready. Please wait.");
      return;
    }
    setLoading(true);
    setResults(null);
    setError("");

    if (!studentIdInput.trim()) {
      setError("Please enter a Student ID.");
      setLoading(false);
      return;
    }

    try {
      // Query Firestore for student data
      const publicResultsCollectionRef = collection(
        db,
        `artifacts/${currentAppId}/public/data/universityResults`
      );
      const q = query(
        publicResultsCollectionRef,
        where("studentId", "==", studentIdInput.trim())
      );
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        // If results found, process and display the first matching document
        querySnapshot.forEach((document) => {
          const studentData = document.data();
          // Generate dynamic remarks based on fetched CGPA and course grades
          studentData.dynamicRemarks = getRemarksByCGPA(
            studentData.cgpa,
            studentData.courseResults || []
          );
          setResults(studentData);
        });
      } else {
        setError("No results found for this Student ID. Please check the ID.");
      }
    } catch (e) {
      console.error("Error fetching documents: ", e);
      setError("Error fetching results. Please try again later. " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- CSV Import Functions (Admin Only) ---
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    } else {
      setSelectedFile(null);
    }
  };

  const parseCsvData = (csvString) => {
    const lines = csvString.trim().split("\n");
    if (lines.length === 0) return [];

    const headers = lines[0].split(",").map((header) => header.trim());
    const data = [];

    console.log("CSV Headers (from file):", headers);

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((value) => value.trim());
      // Skip malformed rows where number of values doesn't match headers
      if (values.length !== headers.length) {
        console.warn(
          `Skipping malformed row (header/value count mismatch): ${lines[i]}`
        );
        continue;
      }

      const studentData = {
        courseResults: [],
      };

      headers.forEach((header, index) => {
        const value = values[index];
        const normalizedHeader = header.replace(/\s+/g, "").toLowerCase();

        // Map common student info headers
        if (normalizedHeader.includes("studentid")) {
          studentData.studentId = value;
        } else if (normalizedHeader === "name") {
          studentData.name = value;
        } else if (normalizedHeader === "department") {
          studentData.department = value;
        } else if (normalizedHeader === "session") {
          studentData.session = value;
        } else if (normalizedHeader === "batch") {
          studentData.batch = value;
        } else if (normalizedHeader === "cgpa") {
          studentData.cgpa = value;
        } else if (normalizedHeader === "remarks") {
          studentData.remarks = value;
        } else {
          // Treat any other header as a course code with its value as the grade
          if (value && value.trim() !== "") {
            studentData.courseResults.push({
              courseCode: header,
              grade: value,
            });
          }
        }
      });

      // Only include student data if a student ID was successfully parsed
      if (studentData.studentId) {
        data.push(studentData);
      } else {
        console.warn(
          "Skipping record due to missing Student ID after parsing:",
          studentData
        );
      }
    }
    console.log("Parsed CSV Data (before Firestore):", data);
    return data;
  };

  const uploadCsvFileToFirestore = async () => {
    // Ensure admin is logged in before allowing file upload
    if (!authReady || !isAdmin) {
      setError("Unauthorized access. Please log in as admin.");
      return;
    }
    setLoading(true);
    setError("");

    if (!selectedFile) {
      setError("Please select a CSV file.");
      setLoading(false);
      return;
    }

    if (selectedFile.type !== "text/csv") {
      setError("Please select a valid CSV file (.csv).");
      setLoading(false);
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const csvString = event.target.result;
        const parsedData = parseCsvData(csvString);

        if (parsedData.length === 0) {
          setError(
            "No valid student records found in CSV. Please check the format and ensure it contains student IDs and data."
          );
          setLoading(false);
          return;
        }

        const publicResultsCollectionRef = collection(
          db,
          `artifacts/${currentAppId}/public/data/universityResults`
        );

        for (const student of parsedData) {
          if (!student.studentId) {
            console.warn(
              "Skipping record during Firestore upload due to missing studentId:",
              student
            );
            continue;
          }

          const docReference = doc(
            publicResultsCollectionRef,
            student.studentId
          );
          await setDoc(
            docReference,
            {
              // Corrected setSetDoc to setDoc
              studentId: student.studentId,
              name: student.name || "",
              department: student.department || "",
              session: student.session || "",
              batch: student.batch || "",
              cgpa: student.cgpa || "",
              remarks: student.remarks || "",
              courseResults:
                student.courseResults.map((course) => ({
                  courseCode: course.courseCode,
                  grade: course.grade,
                })) || [],
            },
            { merge: true }
          );
          console.log(`Successfully uploaded student: ${student.studentId}`);
        }
        setShowImportCSVModal(false);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        alertUser("CSV data uploaded successfully!", "success");
      };
      reader.readAsText(selectedFile);
    } catch (e) {
      console.error("Error uploading CSV data to Firestore: ", e);
      setError("Failed to upload CSV data: " + e.message);
      alertUser("Failed to upload CSV data: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // --- Manual Add Functions (Admin Only) ---
  const handleManualInputChange = (e) => {
    const { name, value } = e.target;
    setManualStudentData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCourseChange = (index, e) => {
    const { name, value } = e.target;
    const updatedCourses = manualStudentData.courseResults.map((course, i) =>
      i === index ? { ...course, [name]: value } : course
    );
    setManualStudentData((prev) => ({
      ...prev,
      courseResults: updatedCourses,
    }));
  };

  const addCourseField = () => {
    setManualStudentData((prev) => ({
      ...prev,
      courseResults: [...prev.courseResults, { courseCode: "", grade: "" }],
    }));
  };

  const removeCourseField = (index) => {
    setManualStudentData((prev) => ({
      ...prev,
      courseResults: manualStudentData.courseResults.filter(
        (_, i) => i !== index
      ),
    }));
  };

  const addManualStudentToFirestore = async () => {
    // Ensure admin is logged in before allowing manual data entry
    if (!authReady || !isAdmin) {
      setError("Unauthorized access. Please log in as admin.");
      return;
    }
    setLoading(true);
    setError("");

    if (!manualStudentData.studentId.trim() || !manualStudentData.name.trim()) {
      setError("Student ID and Name are required.");
      setLoading(false);
      return;
    }

    try {
      const publicResultsCollectionRef = collection(
        db,
        `artifacts/${currentAppId}/public/data/universityResults`
      );
      const docReference = doc(
        publicResultsCollectionRef,
        manualStudentData.studentId.trim()
      );
      await setDoc(
        docReference,
        {
          studentId: manualStudentData.studentId.trim(),
          name: manualStudentData.name.trim(),
          department: manualStudentData.department.trim(),
          session: manualStudentData.session.trim(),
          batch: manualStudentData.batch.trim() || "",
          cgpa: manualStudentData.cgpa.trim(),
          remarks: manualStudentData.remarks?.trim() || "",
          courseResults: manualStudentData.courseResults
            .filter((course) => course.courseCode.trim() && course.grade.trim())
            .map((course) => ({
              courseCode: course.courseCode.trim(),
              grade: course.grade.trim(),
            })),
        },
        { merge: true }
      );

      setShowManualAddModal(false);
      // Reset form fields after successful submission
      setManualStudentData({
        studentId: "",
        name: "",
        department: "",
        session: "",
        batch: "",
        cgpa: "",
        remarks: "",
        courseResults: [{ courseCode: "", grade: "" }],
      });
      alertUser("Student data added/updated successfully!", "success");
    } catch (e) {
      console.error("Error adding manual student data: ", e);
      setError("Failed to add student data: " + e.message);
      alertUser("Failed to add student data: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // --- Admin Login/Logout Functions ---
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      // Step 1: Ensure any previous user is signed out completely
      if (auth.currentUser) {
        await signOut(auth);
        console.log(
          "Firebase Auth Debug: Signed out current user before login attempt."
        );
      }

      // Step 2: Attempt to sign in with provided admin email and password
      const userCredential = await signInWithEmailAndPassword(
        auth,
        adminEmail,
        adminPassword
      );
      console.log(
        "Firebase Auth Debug: signInWithEmailAndPassword successful. User email:",
        userCredential.user?.email
      );

      // Step 3: Verify the logged-in user is the designated admin
      if (userCredential.user && userCredential.user.email === ADMIN_EMAIL) {
        setIsAdmin(true);
        setShowAdminLoginModal(false);
        alertUser("Admin logged in successfully!", "success");
        console.log("Firebase Auth Debug: isAdmin set to true.");
      } else {
        // This case handles a valid Firebase login but not with the specific ADMIN_EMAIL
        console.warn(
          "Firebase Auth Debug: Logged in user email does not match ADMIN_EMAIL."
        );
        setLoginError("Invalid admin credentials.");
        // Ensure anonymous sign-in is attempted if email mismatch occurs
        await signOut(auth); // Sign out the non-admin user
        await signInAnonymously(auth); // Revert to anonymous for public view
        setIsAdmin(false);
      }
    } catch (error) {
      console.error("Admin login error:", error);
      // Provide user-friendly error messages
      if (
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        setLoginError("Incorrect email or password.");
      } else if (error.code === "auth/invalid-email") {
        setLoginError("Invalid email format.");
      } else {
        setLoginError(
          "Login failed. Please try again. Error: " + error.message
        ); // Show actual message for unknown errors
      }
      // Ensure anonymous sign-in is attempted if admin login fails
      try {
        await signOut(auth);
        await signInAnonymously(auth);
      } catch (anonError) {
        console.error(
          "Failed to re-authenticate anonymously after failed admin login:",
          anonError
        );
      }
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogout = async () => {
    setLoading(true);
    try {
      console.log("Firebase Auth Debug: Attempting logout.");
      await signOut(auth);
      setIsAdmin(false);
      alertUser("Logged out successfully!", "info");
      console.log(
        "Firebase Auth Debug: Signed out. Re-authenticating anonymously."
      );
      // Immediately sign in anonymously after logout to restore public access
      await signInAnonymously(auth);
      console.log("Firebase Auth Debug: Signed in anonymously after logout.");
    } catch (error) {
      console.error("Logout error:", error);
      alertUser("Logout failed.", "error");
    } finally {
      setLoading(false);
    }
  };

  // --- Custom Alert Message Box ---
  const [messageBox, setMessageBox] = useState({
    visible: false,
    message: "",
    type: "",
  });

  const alertUser = (message, type = "info") => {
    setMessageBox({ visible: true, message, type });
    // Hide the message after 3 seconds
    setTimeout(() => {
      setMessageBox({ visible: false, message: "", type: "" });
    }, 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-800 font-inter text-white flex flex-col items-center justify-center p-4">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      {/* Tailwind CSS Script - Ensures styles are loaded */}
      <script src="https://cdn.tailwindcss.com"></script>
      {/* Font for Inter - Ensures font is loaded */}
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      <style>
        {`
        body {
          font-family: 'Inter', sans-serif;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.5s ease-out forwards;
        }
        .animate-slide-in-up {
          animation: slideInUp 0.6s ease-out forwards;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
        }
        .loader {
          border: 4px solid #f3f3f3; 
          border-top: 4px solid #3498db; 
          border-radius: 50%;
          width: 20px;
          height: 20px;
          animation: spin 2s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .text-shadow-light {
            text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
        }
        `}
      </style>

      {/* Custom Message Box Display */}
      {messageBox.visible && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 p-4 rounded-lg shadow-xl text-center z-50 animate-fade-in
          ${
            messageBox.type === "success"
              ? "bg-green-500"
              : messageBox.type === "error"
              ? "bg-red-500"
              : "bg-blue-500"
          } text-white`}
        >
          {messageBox.message}
        </div>
      )}

      {/* Header Section */}
      <div className="w-full max-w-2xl text-center mb-8 animate-fade-in">
        <h1 className="text-4xl md:text-5xl font-bold mb-2 tracking-tight text-shadow-light">
          Khwaja Yunus Ali University
        </h1>
        <h2 className="text-3xl md:text-4xl font-bold mb-2 tracking-tight text-shadow-light">
          Result Portal
        </h2>
        <p className="text-lg md:text-xl text-blue-100">
          Find your academic results quickly.
        </p>
      </div>

      {/* Search Form */}
      <form
        onSubmit={searchResults}
        className="w-full max-w-lg glass-card p-6 md:p-8 rounded-xl shadow-lg mb-8 animate-slide-in-up"
      >
        <label
          htmlFor="studentId"
          className="block text-blue-100 text-lg font-medium mb-3"
        >
          Enter Student ID:
        </label>
        <div className="flex items-center space-x-3">
          <input
            type="text"
            id="studentId"
            className="flex-grow p-3 rounded-lg bg-white bg-opacity-20 border border-blue-300 border-opacity-50 text-white placeholder-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-300 transition duration-300"
            placeholder="Enter the 10 digits"
            value={studentIdInput}
            onChange={(e) => setStudentIdInput(e.target.value)}
            required
          />
          <button
            type="submit"
            className="flex-shrink-0 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-300 flex items-center justify-center"
            disabled={loading}
          >
            {loading ? (
              <div className="loader border-white border-t-blue-300"></div>
            ) : (
              "Search"
            )}
          </button>
        </div>
        {error && (
          <p className="mt-4 text-red-300 text-sm animate-fade-in">{error}</p>
        )}
      </form>

      {/* Admin Panel Access / Management Buttons */}
      <div className="flex flex-wrap justify-center gap-4 mb-8 w-full max-w-lg">
        {isAdmin ? ( // If isAdmin is true, show admin management buttons and logout
          <>
            <button
              onClick={() => setShowImportCSVModal(true)}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-300"
            >
              Import CSV Data
            </button>
            <button
              onClick={() => setShowManualAddModal(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-orange-300"
            >
              Manually Add Student
            </button>
            <button
              onClick={handleAdminLogout}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              Logout Admin
            </button>
          </>
        ) : (
          // If not admin, show Admin Login button
          <button
            onClick={() => setShowAdminLoginModal(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            Admin Login
          </button>
        )}
      </div>

      {/* Admin Login Modal (Conditionally Rendered) */}
      {showAdminLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <form
            onSubmit={handleAdminLogin}
            className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl max-w-sm w-full"
          >
            <h3 className="text-2xl font-bold mb-4 text-center">Admin Login</h3>
            <div className="mb-4">
              <label
                className="block text-gray-700 text-sm font-bold mb-2"
                htmlFor="adminEmail"
              >
                Email:
              </label>
              <input
                type="email"
                id="adminEmail"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                required
              />
            </div>
            <div className="mb-6">
              <label
                className="block text-gray-700 text-sm font-bold mb-2"
                htmlFor="adminPassword"
              >
                Password:
              </label>
              <input
                type="password"
                id="adminPassword"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-3 leading-tight focus:outline-none focus:shadow-outline"
                required
              />
            </div>
            {loginError && (
              <p className="text-red-500 text-sm italic mb-4 text-center">
                {loginError}
              </p>
            )}
            <div className="flex items-center justify-between">
              <button
                type="submit"
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
                disabled={loading}
              >
                {loading ? "Logging in..." : "Login"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdminLoginModal(false);
                  setLoginError("");
                }} // Clear error on cancel
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import CSV Modal (Conditionally Rendered) */}
      {showImportCSVModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl max-w-2xl w-full">
            <h3 className="text-2xl font-bold mb-4 text-center">
              Import Student Data from CSV File
            </h3>
            <p className="mb-4 text-gray-700 text-sm text-center">
              Please save your Excel sheet as a **CSV (Comma Separated Values)**
              file. Then, select the CSV file here.
              <br />
              The app will automatically recognize columns like "Student ID",
              "Name", "Department", "Session", "Batch", "CGPA", and any other
              columns as Course Codes (e.g., "CSE 1211", "PHY 101"), with their
              values treated as Grades.
            </p>
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="w-full p-3 mb-4 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {selectedFile && (
              <p className="mb-4 text-gray-600 text-sm">
                Selected file:{" "}
                <span className="font-semibold">{selectedFile.name}</span>
              </p>
            )}
            <div className="flex justify-center space-x-4">
              <button
                onClick={uploadCsvFileToFirestore}
                className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-5 rounded-lg shadow-md transition duration-300"
                disabled={loading || !selectedFile}
              >
                {loading ? (
                  <div className="loader border-white border-t-blue-300"></div>
                ) : (
                  "Upload File"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowImportCSVModal(false);
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  setError("");
                }}
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-5 rounded-lg shadow-md transition duration-300"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
            {error && (
              <p className="mt-4 text-red-500 text-sm text-center">{error}</p>
            )}
          </div>
        </div>
      )}

      {/* Manual Add Student Modal (Conditionally Rendered) */}
      {showManualAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in overflow-y-auto">
          <div className="bg-white text-gray-800 p-8 rounded-xl shadow-2xl max-w-2xl w-full my-8">
            <h3 className="text-2xl font-bold mb-6 text-center">
              Manually Add/Update Student Data
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label
                  className="block text-gray-700 text-sm font-bold mb-2"
                  htmlFor="manualStudentId"
                >
                  Student ID:
                </label>
                <input
                  type="text"
                  id="manualStudentId"
                  name="studentId"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={manualStudentData.studentId}
                  onChange={handleManualInputChange}
                  required
                />
              </div>
              <div>
                <label
                  className="block text-gray-700 text-sm font-bold mb-2"
                  htmlFor="manualName"
                >
                  Name:
                </label>
                <input
                  type="text"
                  id="manualName"
                  name="name"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={manualStudentData.name}
                  onChange={handleManualInputChange}
                  required
                />
              </div>
              <div>
                <label
                  className="block text-gray-700 text-sm font-bold mb-2"
                  htmlFor="manualDepartment"
                >
                  Department:
                </label>
                <input
                  type="text"
                  id="manualDepartment"
                  name="department"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={manualStudentData.department}
                  onChange={handleManualInputChange}
                />
              </div>
              <div>
                <label
                  className="block text-gray-700 text-sm font-bold mb-2"
                  htmlFor="manualSession"
                >
                  Session:
                </label>
                <input
                  type="text"
                  id="manualSession"
                  name="session"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={manualStudentData.session}
                  onChange={handleManualInputChange}
                />
              </div>
              <div>
                <label
                  className="block text-gray-700 text-sm font-bold mb-2"
                  htmlFor="manualCGPA"
                >
                  CGPA:
                </label>
                <input
                  type="text"
                  id="manualCGPA"
                  name="cgpa"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={manualStudentData.cgpa}
                  onChange={handleManualInputChange}
                />
              </div>
              <div>
                <label
                  className="block text-gray-700 text-sm font-bold mb-2"
                  htmlFor="manualBatch"
                >
                  Batch:
                </label>
                <input
                  type="text"
                  id="manualBatch"
                  name="batch"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={manualStudentData.batch || ""}
                  onChange={handleManualInputChange}
                />
              </div>
            </div>

            <h4 className="text-xl font-bold mb-4 border-b pb-2">
              Course Results
            </h4>
            {manualStudentData.courseResults.map((course, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 items-end bg-gray-100 p-4 rounded-lg"
              >
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Course Code:
                  </label>
                  <input
                    type="text"
                    name="courseCode"
                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    value={course.courseCode}
                    onChange={(e) => handleCourseChange(index, e)}
                  />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Grade:
                  </label>
                  <input
                    type="text"
                    name="grade"
                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    value={course.grade}
                    onChange={(e) => handleCourseChange(index, e)}
                  />
                </div>
                <div className="col-span-full flex justify-end">
                  {manualStudentData.courseResults.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCourseField(index)}
                      className="text-red-500 hover:text-red-700 font-bold py-2 px-4 rounded"
                    >
                      Remove Course
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addCourseField}
              className="bg-blue-400 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-300 mb-6"
            >
              + Add Course
            </button>

            <div className="flex justify-center space-x-4">
              <button
                type="submit"
                onClick={addManualStudentToFirestore}
                className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-5 rounded-lg shadow-md transition duration-300"
                disabled={loading}
              >
                {loading ? (
                  <div className="loader border-white border-t-blue-300"></div>
                ) : (
                  "Save Student Data"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowManualAddModal(false);
                  setError("");
                }}
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-5 rounded-lg shadow-md transition duration-300"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
            {error && (
              <p className="mt-4 text-red-500 text-sm text-center">{error}</p>
            )}
          </div>
        </div>
      )}

      {/* Results Display */}
      {results && (
        <div className="w-full max-w-3xl glass-card p-6 md:p-10 rounded-xl shadow-lg animate-slide-in-up">
          <h2 className="text-3xl font-bold mb-6 text-center text-blue-100">
            Result for {results.name}
          </h2>

          {/* Student Info Display Grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-6 text-lg">
            <div className="col-span-1">
              <p>
                <span className="font-semibold text-blue-200">Student ID:</span>{" "}
                {results.studentId}
              </p>
            </div>
            <div className="col-span-1">
              <p>
                <span className="font-semibold text-blue-200">Department:</span>{" "}
                {results.department || "N/A"}
              </p>
            </div>
            <div className="col-span-1">
              <p>
                <span className="font-semibold text-blue-200">Session:</span>{" "}
                {results.session || "N/A"}
              </p>
            </div>
            <div className="col-span-1">
              <p>
                <span className="font-semibold text-blue-200">Batch:</span>{" "}
                {results.batch || "N/A"}
              </p>
            </div>
            <div className="col-span-2">
              <p>
                <span className="font-semibold text-blue-200">CGPA:</span>{" "}
                {results.cgpa}
              </p>
            </div>
            <div className="col-span-2">
              <p>
                <span className="font-semibold text-blue-200">Remarks:</span>{" "}
                {results.dynamicRemarks}
              </p>
            </div>
          </div>

          <h3 className="text-2xl font-bold mb-4 text-blue-100 border-b border-blue-300 pb-2">
            Course Grades
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left table-auto">
              <thead>
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Course Code</th>
                  <th className="px-4 py-3 rounded-tr-lg">Grade</th>
                </tr>
              </thead>
              <tbody>
                {results.courseResults && results.courseResults.length > 0 ? (
                  results.courseResults.map((course, index) => (
                    <tr
                      key={index}
                      className="border-t border-white border-opacity-10 hover:bg-white hover:bg-opacity-5 transition duration-200"
                    >
                      <td className="px-4 py-3">{course.courseCode}</td>
                      <td className="px-4 py-3 font-semibold">
                        {course.grade}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan="2"
                      className="px-4 py-3 text-center text-blue-200"
                    >
                      No course results available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
