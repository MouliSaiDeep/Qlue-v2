require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");

const { registerUser } = require("./src/handlers/auth/registerUser");
const { loginUser } = require("./src/handlers/auth/loginUser");
const { validateToken } = require("./src/handlers/auth/validateToken");
const { loginWithGoogle } = require("./src/handlers/auth/loginWithGoogle");
const { refreshToken } = require("./src/handlers/auth/refreshToken");
const { logoutUser } = require("./src/handlers/auth/logoutUser");
const { deleteAccount } = require("./src/handlers/auth/deleteAccount");
const { getUserProfile } = require("./src/handlers/auth/getUserProfile");
const { updateUserProfile } = require("./src/handlers/auth/updateUserProfile");
const { generatePresignedUrl } = require("./src/handlers/resume/generatePresignedUrl");
const { getResumeList } = require("./src/handlers/resume/getResumeList");
const { getResumeDetail } = require("./src/handlers/resume/getResumeDetail");
const { updateResumeParsedData } = require("./src/handlers/resume/updateResumeParsedData");
const { deleteResume } = require("./src/handlers/resume/deleteResume");
const { setActiveResume } = require("./src/handlers/resume/setActiveResume");
const { validateResumeHash } = require("./src/handlers/resume/validateResumeHash");

const app = express();
app.use(bodyParser.json());

console.log("UPDATED SERVER RUNNING");

app.post("/auth/register", registerUser);
app.post("/auth/login", loginUser);
app.post("/auth/refresh", refreshToken);
app.get("/auth/test", validateToken);
app.post("/auth/login/google", loginWithGoogle);
app.post("/auth/logout", logoutUser);
app.delete("/auth/account", deleteAccount);
app.get("/auth/profile", getUserProfile);
app.put("/auth/profile", updateUserProfile);

// Resumes
app.post("/resumes/upload-url", generatePresignedUrl);
app.get("/resumes", getResumeList);
app.get("/resumes/:resumeId", getResumeDetail);
app.patch("/resumes/:resumeId", updateResumeParsedData);
app.delete("/resumes/:resumeId", deleteResume);
app.post("/resumes/set-active", setActiveResume);
app.post("/resumes/validate-hash", validateResumeHash);

// Root
app.get("/", (req, res) => {
  res.send("Server is running ");
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
