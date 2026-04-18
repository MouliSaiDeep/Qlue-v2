enum ResumeStatus {
  pending,
  uploading,
  parsing,
  parsed,
  failed;

  static ResumeStatus fromString(String status) {
    switch (status.toLowerCase()) {
      case 'pending':
        return ResumeStatus.pending;
      case 'uploading':
        return ResumeStatus.uploading;
      case 'parsing':
        return ResumeStatus.parsing;
      case 'parsed':
        return ResumeStatus.parsed;
      case 'failed':
      default:
        return ResumeStatus.failed;
    }
  }
}

class ContactModel {
  final String? email;
  final String? phone;
  final String? location;

  ContactModel({this.email, this.phone, this.location});

  factory ContactModel.fromJson(Map<String, dynamic> json) {
    return ContactModel(
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      location: json['location'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'email': email,
    'phone': phone,
    'location': location,
  };
}

class WorkExperienceModel {
  final String? company;
  final String? role;
  final String? duration;
  final List<String>? highlights;

  WorkExperienceModel({this.company, this.role, this.duration, this.highlights});

  factory WorkExperienceModel.fromJson(Map<String, dynamic> json) {
    return WorkExperienceModel(
      company: json['company'] as String?,
      role: json['role'] as String?,
      duration: json['duration'] as String?,
      highlights: (json['highlights'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );
  }

  Map<String, dynamic> toJson() => {
    'company': company,
    'role': role,
    'duration': duration,
    'highlights': highlights,
  };
}

class ProjectModel {
  final String? name;
  final List<String>? technologies;
  final String? description;

  ProjectModel({this.name, this.technologies, this.description});

  factory ProjectModel.fromJson(Map<String, dynamic> json) {
    return ProjectModel(
      name: json['name'] as String?,
      technologies: (json['technologies'] as List<dynamic>?)?.map((e) => e as String).toList(),
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'technologies': technologies,
    'description': description,
  };
}

class EducationModel {
  final String? institution;
  final String? degree;
  final String? year;

  EducationModel({this.institution, this.degree, this.year});

  factory EducationModel.fromJson(Map<String, dynamic> json) {
    return EducationModel(
      institution: json['institution'] as String?,
      degree: json['degree'] as String?,
      year: json['year'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'institution': institution,
    'degree': degree,
    'year': year,
  };
}

class ParsedDataModel {
  final String? name;
  final ContactModel? contact;
  final List<String>? skills;
  final List<WorkExperienceModel>? workExperience;
  final List<ProjectModel>? projects;
  final List<EducationModel>? education;

  ParsedDataModel({
    this.name,
    this.contact,
    this.skills,
    this.workExperience,
    this.projects,
    this.education,
  });

  factory ParsedDataModel.fromJson(Map<String, dynamic> json) {
    return ParsedDataModel(
      name: json['name'] as String?,
      contact: json['contact'] != null ? ContactModel.fromJson(json['contact']) : null,
      skills: (json['skills'] as List<dynamic>?)?.map((e) => e as String).toList(),
      workExperience: (json['workExperience'] as List<dynamic>?)?.map((e) => WorkExperienceModel.fromJson(e as Map<String, dynamic>)).toList(),
      projects: (json['projects'] as List<dynamic>?)?.map((e) => ProjectModel.fromJson(e as Map<String, dynamic>)).toList(),
      education: (json['education'] as List<dynamic>?)?.map((e) => EducationModel.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'contact': contact?.toJson(),
    'skills': skills,
    'workExperience': workExperience?.map((e) => e.toJson()).toList(),
    'projects': projects?.map((e) => e.toJson()).toList(),
    'education': education?.map((e) => e.toJson()).toList(),
  };
}

class ResumeModel {
  final String resumeId;
  final String? userId;
  final String fileName;
  final int fileSize;
  final String? fileHash;
  final String? s3Key;
  final ResumeStatus status;
  final int? uploadedAt;
  final bool isActive;
  final String? failReason;
  final ParsedDataModel? parsedData;

  ResumeModel({
    required this.resumeId,
    this.userId,
    required this.fileName,
    required this.fileSize,
    this.fileHash,
    this.s3Key,
    required this.status,
    this.uploadedAt,
    this.isActive = false,
    this.failReason,
    this.parsedData,
  });

  factory ResumeModel.fromJson(Map<String, dynamic> json) {
    return ResumeModel(
      resumeId: json['resumeId'] as String,
      userId: json['userId'] as String?,
      fileName: json['fileName'] as String,
      fileSize: json['fileSize'] as int,
      fileHash: json['fileHash'] as String?,
      s3Key: json['s3Key'] as String?,
      status: ResumeStatus.fromString(json['status'] as String? ?? 'pending'),
      uploadedAt: json['uploadedAt'] as int?,
      isActive: json['isActive'] as bool? ?? false,
      failReason: json['failReason'] as String?,
      parsedData: json['parsedData'] != null ? ParsedDataModel.fromJson(json['parsedData']) : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'resumeId': resumeId,
    'userId': userId,
    'fileName': fileName,
    'fileSize': fileSize,
    'fileHash': fileHash,
    's3Key': s3Key,
    'status': status.name,
    'uploadedAt': uploadedAt,
    'isActive': isActive,
    'failReason': failReason,
    'parsedData': parsedData?.toJson(),
  };
}
