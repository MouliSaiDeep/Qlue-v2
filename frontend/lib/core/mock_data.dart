class Session {
  final String id;
  final String topic;
  final String date;
  final int duration; // in seconds
  final int score;
  final String module;
  final int answeredQuestions;
  final int totalQuestions;
  final List<String> tags;

  Session({
    required this.id,
    required this.topic,
    required this.date,
    required this.duration,
    required this.score,
    required this.module,
    this.answeredQuestions = 10,
    this.totalQuestions = 10,
    this.tags = const ["Analytical", "Confident"],
  });
}

final List<Session> mockSessions = [
  Session(id: "1", topic: "Product Manager Role", date: "TODAY", duration: 1800, score: 85, module: "resume", answeredQuestions: 15, totalQuestions: 15, tags: ["Analytical", "Confident"]),
  Session(id: "2", topic: "Behavioral Questions", date: "YESTERDAY", duration: 1200, score: 72, module: "hr", answeredQuestions: 12, totalQuestions: 12, tags: ["Communication", "Confident"]),
  Session(id: "3", topic: "Frontend Developer", date: "3 DAYS AGO", duration: 2400, score: 90, module: "website", answeredQuestions: 20, totalQuestions: 20, tags: ["Technical", "Precise"]),
  Session(id: "4", topic: "Technical Lead", date: "LAST WEEK", duration: 1800, score: 68, module: "resume", answeredQuestions: 8, totalQuestions: 10),
  Session(id: "5", topic: "Leadership Skills", date: "LAST WEEK", duration: 900, score: 95, module: "hr", answeredQuestions: 10, totalQuestions: 10),
  Session(id: "6", topic: "Full Stack Developer", date: "2 WEEKS AGO", duration: 2400, score: 60, module: "website", answeredQuestions: 6, totalQuestions: 15),
];

class Experience {
  final String role;
  final String company;
  final String years;
  final String? description;

  Experience({required this.role, required this.company, required this.years, this.description});
}

class Education {
  final String degree;
  final String institution;
  final String year;

  Education({required this.degree, required this.institution, required this.year});
}

class Resume {
  final String id;
  final String filename;
  final String uploadDate;
  final String status; // "parsed" | "parsing" | "failed"
  final List<String> skills;
  final String format; // "pdf" | "docx"
  final String fileSize;
  final String? summary;
  final List<Experience>? experience;
  final List<Education>? education;

  Resume({
    required this.id,
    required this.filename,
    required this.uploadDate,
    required this.status,
    required this.skills,
    required this.format,
    required this.fileSize,
    this.summary,
    this.experience,
    this.education,
  });
}

List<Resume> mockResumes = [
  Resume(
    id: "1",
    filename: "software_engineer_cv.pdf",
    uploadDate: "Oct 12, 2023",
    status: "parsed",
    skills: ["React", "TypeScript", "Node.js", "GraphQL", "AWS", "Docker"],
    format: "pdf",
    fileSize: "1.2 MB",
    summary: "Full-stack software engineer with 5+ years of experience building scalable web applications. Proficient in React, TypeScript and cloud-native architectures.",
    experience: [
      Experience(role: "Senior Software Engineer", company: "TechCorp Inc.", years: "2021–Present", description: "Led a team of 5 engineers to build a microservices-based platform serving 1M+ users."),
      Experience(role: "Software Engineer", company: "StartupXYZ", years: "2019–2021", description: "Built and maintained core product features using React and Node.js."),
    ],
    education: [
      Education(degree: "B.S. Computer Science", institution: "MIT", year: "2019"),
    ],
  ),
  Resume(
    id: "2",
    filename: "product_manager_resume.docx",
    uploadDate: "Oct 10, 2023",
    status: "parsed",
    skills: ["Agile", "Scrum", "Jira", "Roadmapping", "A/B Testing"],
    format: "docx",
    fileSize: "840 KB",
    summary: "Product manager with deep expertise in agile methodologies and data-driven decision making.",
    experience: [
      Experience(role: "Product Manager", company: "BigCo", years: "2020–Present", description: "Owned product roadmap for a B2B SaaS platform with \$5M ARR."),
      Experience(role: "Associate PM", company: "GrowthStartup", years: "2018–2020"),
    ],
    education: [
      Education(degree: "MBA", institution: "Stanford University", year: "2018"),
      Education(degree: "B.A. Economics", institution: "UC Berkeley", year: "2016"),
    ],
  ),
  Resume(
    id: "3",
    filename: "data_analyst_2023.pdf",
    uploadDate: "Today",
    status: "parsing",
    skills: [],
    format: "pdf",
    fileSize: "2.1 MB",
  ),
];
