require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const firebase = require("./src/lib/firebase");

// Auth Handlers (These export AWS Lambda handlers)
const registerUser = require("./src/handlers/auth/registerUser").handler;
const loginUser = require("./src/handlers/auth/loginUser").handler;
const validateToken = require("./src/handlers/auth/validateToken").handler;
const loginWithGoogle = require("./src/handlers/auth/loginWithGoogle").handler;
const refreshToken = require("./src/handlers/auth/refreshToken").handler;
const logoutUser = require("./src/handlers/auth/logoutUser").handler;
const deleteAccount = require("./src/handlers/auth/deleteAccount").handler;
const getUserProfile = require("./src/handlers/auth/getUserProfile").handler;
const updateUserProfile = require("./src/handlers/auth/updateUserProfile").handler;
const syncUser = require("./src/handlers/auth/syncUser").handler;

// Resume Handlers (These export AWS Lambda handlers)
const generatePresignedUrl = require("./src/handlers/resume/generatePresignedUrl").handler;
const getResumeList = require("./src/handlers/resume/getResumeList").handler;
const getResumeDetail = require("./src/handlers/resume/getResumeDetail").handler;
const updateResumeParsedData = require("./src/handlers/resume/updateResumeParsedData").handler;
const deleteResume = require("./src/handlers/resume/deleteResume").handler;
const setActiveResume = require("./src/handlers/resume/setActiveResume").handler;
const validateResumeHash = require("./src/handlers/resume/validateResumeHash").handler;
const processResumeUpload = require("./src/handlers/resume/processResumeUpload").handler;

// Interview Handlers
const initializeSession = require("./src/handlers/interview/initializeSession").handler;
const processUserInput = require("./src/handlers/interview/processUserInput").handler;
const generateQuestion = require("./src/handlers/interview/generateQuestion").handler;
const terminateSession = require("./src/handlers/interview/terminateSession").handler;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Request Logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Firebase Auth Middleware
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
            const decodedToken = await firebase.verifyIdToken(idToken);
            req.user = decodedToken;
        } catch (error) {
            console.error('Error verifying Firebase ID token:', error.message);
        }
    } else {
        // Fallback for local dev testing
        req.user = { uid: "local-dev-user" };
    }
    next();
};

// Lambda to Express Adapter
function lambdaToExpress(handler) {
  return async (req, res) => {
    const event = {
      body: req.body ? JSON.stringify(req.body) : null,
      pathParameters: req.params || {},
      queryStringParameters: req.query || {},
      requestContext: { authorizer: { uid: req.user?.uid } },
    };
    try {
        const result = await handler(event);
        res.status(result.statusCode).json(JSON.parse(result.body));
    } catch (error) {
        console.error("Lambda Handler Error:", error);
        res.status(500).json({ error: 'SERVER_ERROR', message: error.message });
    }
  };
}


// Auth Routes
app.post("/auth/register", lambdaToExpress(registerUser));
app.post("/auth/login", lambdaToExpress(loginUser));
app.post("/auth/refresh", lambdaToExpress(refreshToken));
app.get("/auth/test", lambdaToExpress(validateToken));
app.post("/auth/sync", authMiddleware, lambdaToExpress(syncUser));
app.post("/auth/login/google", lambdaToExpress(loginWithGoogle));
app.post("/auth/logout", lambdaToExpress(logoutUser));
app.delete("/auth/account", lambdaToExpress(deleteAccount));
app.get("/auth/profile", authMiddleware, lambdaToExpress(getUserProfile));
app.put("/auth/profile", authMiddleware, lambdaToExpress(updateUserProfile));

// Resume Routes (Unified with SAM template)
app.use("/resume", authMiddleware);
app.post("/resume/upload-url", lambdaToExpress(generatePresignedUrl));
app.get("/resume/list", lambdaToExpress(getResumeList));
app.get("/resume/detail", lambdaToExpress(getResumeDetail));
app.put("/resume/detail", lambdaToExpress(updateResumeParsedData));
app.delete("/resume/detail", lambdaToExpress(deleteResume));
app.put("/resume/active", lambdaToExpress(setActiveResume));
app.post("/resume/validate-hash", lambdaToExpress(validateResumeHash));
app.post("/resume/process", lambdaToExpress(processResumeUpload));

// Interview Routes
app.use("/interview", authMiddleware);
app.post("/interview/init", lambdaToExpress(initializeSession));
app.post("/interview/process", lambdaToExpress(processUserInput));
app.post("/interview/question", lambdaToExpress(generateQuestion));
app.post("/interview/terminate", lambdaToExpress(terminateSession));

// Root
app.get("/", (req, res) => {
  res.send("Server is running ");
});

const server = app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
