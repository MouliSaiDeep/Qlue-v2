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


