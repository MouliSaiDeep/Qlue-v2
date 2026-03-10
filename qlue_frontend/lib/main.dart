import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() async{
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(const ProviderScope(child:QlueApp())) ;
}
class QlueApp extends StatelessWidget {
  const QlueApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: QlueHome(),
      debugShowCheckedModeBanner: false,
    );
  }
}
class QlueHome extends StatelessWidget {
  const QlueHome({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Text("HomeScreen"),
    );
  }
}