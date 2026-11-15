/**
 * ONE CV, WRITTEN IN SEVERAL LANGUAGES (register NB-1).
 *
 * Each set is the same person with the same facts: the same roles, years,
 * team sizes, percentages and certifications, translated the way a person
 * writing in that language would write them (their own section headings, a
 * local phone number and city, a local employer name where the English one
 * names a place). Only the language changes, so the rule-based ATS score
 * should not.
 *
 * The healthcare set's en, es and de texts are the bug audit's probe
 * (~/.config/resumebooster/bug-audit-2026-11-15/verify-free-scan/probe-clamp3.ts)
 * word for word: on the code before the fix they scored 62, 37 and 33.
 */

export type CvLanguage = "en" | "es" | "de" | "fr" | "pt" | "it" | "nl" | "hi";

export interface CvSet {
  /** The field the person works in: every translation is scored against it. */
  industry: string;
  texts: Partial<Record<CvLanguage, string>>;
}

export const NURSE: CvSet = {
  industry: "healthcare",
  texts: {
    en: `Maria Lopez
maria.lopez@example.com | +1 415 555 0134 | Austin, TX
Summary
Registered nurse with eight years of experience in intensive care and emergency departments. Skilled in patient assessment, care planning and team leadership.
Experience
Charge Nurse, St. David's Medical Center, Austin 2019 - Present
- Led a team of 14 nurses on a 32-bed ICU and cut medication errors by 30 percent
- Coordinated patient care plans with physicians, pharmacists and families for 20 patients per shift
- Trained 25 new graduate nurses on electronic health records and infection control
Staff Nurse, Seton Hospital, Austin 2015 - 2019
- Provided critical care to post-surgical patients and monitored vital signs
- Administered medications and IV therapy to 6 patients per shift
- Reduced patient falls by 40 percent through a new hourly rounding protocol
Skills
Patient assessment, critical care, BLS, ACLS, electronic health records, IV therapy, triage, wound care, infection control
Education
Bachelor of Science in Nursing, University of Texas at Austin, 2015
`,
    es: `María López
maria.lopez@example.com | +34 612 345 678 | Madrid, España
Resumen profesional
Enfermera titulada con ocho años de experiencia en cuidados intensivos y urgencias. Experta en valoración de pacientes, planes de cuidados y liderazgo de equipos.
Experiencia laboral
Supervisora de enfermería, Hospital Universitario La Paz, Madrid 2019 - actualidad
- Dirigí un equipo de 14 enfermeras en una UCI de 32 camas y reduje los errores de medicación un 30 por ciento
- Coordiné los planes de cuidados con médicos, farmacéuticos y familias para 20 pacientes por turno
- Formé a 25 enfermeras recién graduadas en historia clínica electrónica y control de infecciones
Enfermera, Hospital Clínico San Carlos, Madrid 2015 - 2019
- Proporcioné cuidados críticos a pacientes posquirúrgicos y controlé constantes vitales
- Administré medicación y terapia intravenosa a 6 pacientes por turno
- Reduje las caídas de pacientes un 40 por ciento con un nuevo protocolo de rondas horarias
Habilidades
Valoración de pacientes, cuidados críticos, SVB, SVA, historia clínica electrónica, terapia intravenosa, triaje, curas, control de infecciones
Formación académica
Grado en Enfermería, Universidad Complutense de Madrid, 2015
`,
    de: `Anna Schmidt
anna.schmidt@example.com | +49 151 23456789 | Berlin
Profil
Examinierte Pflegefachkraft mit acht Jahren Berufserfahrung in der Intensivpflege und Notaufnahme. Stark in Patientenbeobachtung, Pflegeplanung und Teamleitung.
Berufserfahrung
Stationsleitung, Charité Universitätsmedizin, Berlin 2019 - heute
- Leitung eines Teams von 14 Pflegekräften auf einer Intensivstation mit 32 Betten, Medikationsfehler um 30 Prozent gesenkt
- Pflegepläne mit Ärzten, Apothekern und Angehörigen für 20 Patienten pro Schicht abgestimmt
- 25 neue Pflegekräfte in elektronischer Patientenakte und Hygiene eingearbeitet
Pflegefachkraft, Vivantes Klinikum, Berlin 2015 - 2019
- Intensivpflege von Patienten nach Operationen und Überwachung der Vitalzeichen
- Verabreichung von Medikamenten und Infusionstherapie für 6 Patienten pro Schicht
- Stürze von Patienten mit einem neuen stündlichen Rundgangsprotokoll um 40 Prozent reduziert
Kenntnisse
Patientenbeobachtung, Intensivpflege, BLS, ACLS, elektronische Patientenakte, Infusionstherapie, Triage, Wundversorgung, Hygiene
Ausbildung
Bachelor Pflege, Alice Salomon Hochschule Berlin, 2015
`,
    fr: `Marie Lefèvre
marie.lefevre@example.com | +33 6 12 34 56 78 | Lyon, France
Profil
Infirmière diplômée d'État avec huit ans d'expérience en soins intensifs et aux urgences. Compétente en évaluation des patients, planification des soins et encadrement d'équipe.
Expérience professionnelle
Infirmière coordinatrice, Hôpital Édouard Herriot, Lyon 2019 - aujourd'hui
- Encadré une équipe de 14 infirmières dans une unité de soins intensifs de 32 lits et réduit les erreurs de médication de 30 pour cent
- Coordonné les plans de soins avec les médecins, les pharmaciens et les familles pour 20 patients par garde
- Formé 25 infirmières nouvellement diplômées au dossier patient informatisé et à la prévention des infections
Infirmière, Hôpital de la Croix-Rousse, Lyon 2015 - 2019
- Prodigué des soins critiques à des patients en post-opératoire et surveillé les constantes vitales
- Administré les médicaments et les perfusions intraveineuses à 6 patients par garde
- Réduit les chutes de patients de 40 pour cent grâce à un nouveau protocole de tournées horaires
Compétences
Évaluation des patients, soins critiques, BLS, ACLS, dossier patient informatisé, perfusions intraveineuses, triage, soins des plaies, prévention des infections
Formation
Diplôme d'État d'infirmier, Université Claude Bernard Lyon 1, 2015
`,
    pt: `Mariana Souza
mariana.souza@example.com | +55 11 91234 5678 | São Paulo, Brasil
Resumo profissional
Enfermeira com oito anos de experiência em terapia intensiva e pronto-socorro. Especialista em avaliação de pacientes, planejamento de cuidados e liderança de equipes.
Experiência profissional
Enfermeira supervisora, Hospital Israelita Albert Einstein, São Paulo 2019 - atual
- Liderou uma equipe de 14 enfermeiras em uma UTI de 32 leitos e reduziu os erros de medicação em 30 por cento
- Coordenou os planos de cuidados com médicos, farmacêuticos e famílias para 20 pacientes por plantão
- Treinou 25 enfermeiras recém-formadas em prontuário eletrônico e controle de infecção
Enfermeira, Hospital Sírio-Libanês, São Paulo 2015 - 2019
- Prestou cuidados críticos a pacientes no pós-operatório e monitorou os sinais vitais
- Administrou medicamentos e terapia intravenosa para 6 pacientes por plantão
- Reduziu as quedas de pacientes em 40 por cento com um novo protocolo de rondas horárias
Habilidades
Avaliação de pacientes, cuidados críticos, BLS, ACLS, prontuário eletrônico, terapia intravenosa, triagem, curativos, controle de infecção
Formação acadêmica
Bacharelado em Enfermagem, Universidade de São Paulo, 2015
`,
    it: `Giulia Rossi
giulia.rossi@example.com | +39 333 123 4567 | Milano, Italia
Profilo
Infermiera professionale con otto anni di esperienza in terapia intensiva e pronto soccorso. Competente nella valutazione dei pazienti, nella pianificazione dell'assistenza e nella guida di team.
Esperienza professionale
Coordinatrice infermieristica, Ospedale Niguarda, Milano 2019 - oggi
- Ho guidato un team di 14 infermieri in una terapia intensiva da 32 posti letto e ridotto gli errori di terapia del 30 per cento
- Ho coordinato i piani di assistenza con medici, farmacisti e familiari per 20 pazienti per turno
- Ho formato 25 infermieri neolaureati sulla cartella clinica elettronica e sul controllo delle infezioni
Infermiera, Ospedale San Raffaele, Milano 2015 - 2019
- Ho prestato assistenza intensiva a pazienti post-operatori e monitorato i parametri vitali
- Ho somministrato farmaci e terapia endovenosa a 6 pazienti per turno
- Ho ridotto le cadute dei pazienti del 40 per cento con un nuovo protocollo di giri orari
Competenze
Valutazione dei pazienti, assistenza intensiva, BLS, ACLS, cartella clinica elettronica, terapia endovenosa, triage, medicazioni, controllo delle infezioni
Formazione
Laurea in Infermieristica, Università degli Studi di Milano, 2015
`,
    nl: `Sanne de Vries
sanne.devries@example.com | +31 6 12345678 | Utrecht, Nederland
Profiel
Gediplomeerd verpleegkundige met acht jaar ervaring op de intensive care en de spoedeisende hulp. Sterk in patiëntbeoordeling, zorgplanning en teamleiding.
Werkervaring
Senior verpleegkundige, UMC Utrecht, Utrecht 2019 - heden
- Leidde een team van 14 verpleegkundigen op een intensive care met 32 bedden en verminderde medicatiefouten met 30 procent
- Stemde zorgplannen af met artsen, apothekers en families voor 20 patiënten per dienst
- Werkte 25 pas afgestudeerde verpleegkundigen in op het elektronisch patiëntendossier en infectiepreventie
Verpleegkundige, Diakonessenhuis, Utrecht 2015 - 2019
- Verleende intensieve zorg aan postoperatieve patiënten en bewaakte de vitale functies
- Diende medicatie en infuustherapie toe aan 6 patiënten per dienst
- Verminderde valincidenten bij patiënten met 40 procent met een nieuw protocol voor uurlijkse rondes
Vaardigheden
Patiëntbeoordeling, intensieve zorg, BLS, ACLS, elektronisch patiëntendossier, infuustherapie, triage, wondzorg, infectiepreventie
Opleiding
Bachelor Verpleegkunde, Hogeschool Utrecht, 2015
`,
    hi: `प्रिया शर्मा
priya.sharma@example.com | +91 98765 43210 | नई दिल्ली
सारांश
गहन चिकित्सा और आपातकालीन विभागों में आठ वर्षों के अनुभव वाली पंजीकृत नर्स। रोगी मूल्यांकन, देखभाल योजना और टीम नेतृत्व में कुशल।
अनुभव
चार्ज नर्स, अखिल भारतीय आयुर्विज्ञान संस्थान, नई दिल्ली 2019 - वर्तमान
- 32 बिस्तरों वाले आईसीयू में 14 नर्सों की टीम का नेतृत्व किया और दवा की त्रुटियों में 30 प्रतिशत की कमी की
- प्रति शिफ्ट 20 रोगियों के लिए डॉक्टरों, फार्मासिस्टों और परिवारों के साथ देखभाल योजनाओं का समन्वय किया
- 25 नई स्नातक नर्सों को इलेक्ट्रॉनिक स्वास्थ्य रिकॉर्ड और संक्रमण नियंत्रण का प्रशिक्षण दिया
स्टाफ नर्स, सफदरजंग अस्पताल, नई दिल्ली 2015 - 2019
- सर्जरी के बाद के रोगियों को गहन देखभाल दी और महत्वपूर्ण संकेतों की निगरानी की
- प्रति शिफ्ट 6 रोगियों को दवाएँ और आईवी थेरेपी दी
- हर घंटे के राउंड के नए प्रोटोकॉल से रोगियों के गिरने में 40 प्रतिशत की कमी की
कौशल
रोगी मूल्यांकन, गहन देखभाल, BLS, ACLS, इलेक्ट्रॉनिक स्वास्थ्य रिकॉर्ड, आईवी थेरेपी, ट्राइएज, घाव की देखभाल, संक्रमण नियंत्रण
शिक्षा
बी.एससी. नर्सिंग, दिल्ली विश्वविद्यालय, 2015
`,
  },
};

export const ENGINEER: CvSet = {
  industry: "technology",
  texts: {
    en: `Daniel Weber
daniel.weber@example.com | +1 206 555 0187 | Seattle, WA | linkedin.com/in/danielweber
Summary
Senior software engineer with nine years of experience building backend services and data pipelines for payments and logistics platforms. Comfortable owning systems end to end, from design and code review to on-call and incident response.
Experience
Senior Software Engineer, Northwind Payments, Seattle 2020 - Present
- Designed and built a REST API in Go and Python that processes 2 million payment events per day with 99.95 percent availability
- Migrated 14 services from a monolith to Docker containers on Kubernetes in AWS, cutting deployment time from 45 minutes to 6 minutes
- Introduced a CI/CD pipeline with automated testing that reduced production incidents by 35 percent
- Mentored 5 engineers and led code reviews for a team of 9
Software Engineer, Cascade Logistics, Portland 2016 - 2020
- Developed a route-planning service in Java and PostgreSQL used by 1,200 drivers every day
- Built a data pipeline with Kafka and Spark that reduced report generation time by 70 percent
- Improved database query performance by 50 percent through indexing and query rewriting
Junior Developer, Brightline Software, Portland 2015 - 2016
- Maintained a customer portal in JavaScript and React and fixed more than 200 bugs
Skills
Python, Go, Java, JavaScript, React, SQL, PostgreSQL, Kafka, Spark, Docker, Kubernetes, AWS, Terraform, Git, CI/CD, microservices, agile
Education
Bachelor of Science in Computer Science, University of Washington, 2015
Languages
English (native), German (professional)
`,
    es: `Daniel Weber
daniel.weber@example.com | +34 655 123 456 | Barcelona, España | linkedin.com/in/danielweber
Resumen profesional
Ingeniero de software sénior con nueve años de experiencia en el desarrollo de servicios backend y canalizaciones de datos para plataformas de pagos y logística. Acostumbrado a responsabilizarse de los sistemas de principio a fin, desde el diseño y la revisión de código hasta las guardias y la respuesta a incidentes.
Experiencia laboral
Ingeniero de software sénior, Northwind Payments, Barcelona 2020 - actualidad
- Diseñé y desarrollé una API REST en Go y Python que procesa 2 millones de eventos de pago al día con una disponibilidad del 99,95 por ciento
- Migré 14 servicios de un monolito a contenedores Docker en Kubernetes sobre AWS y reduje el tiempo de despliegue de 45 a 6 minutos
- Implanté una canalización de CI/CD con pruebas automatizadas que redujo las incidencias en producción un 35 por ciento
- Fui mentor de 5 ingenieros y dirigí las revisiones de código de un equipo de 9 personas
Ingeniero de software, Cascade Logistics, Valencia 2016 - 2020
- Desarrollé un servicio de planificación de rutas en Java y PostgreSQL que usan 1.200 conductores cada día
- Construí una canalización de datos con Kafka y Spark que redujo el tiempo de generación de informes un 70 por ciento
- Mejoré el rendimiento de las consultas a la base de datos un 50 por ciento mediante índices y la reescritura de consultas
Desarrollador júnior, Brightline Software, Valencia 2015 - 2016
- Mantuve un portal de clientes en JavaScript y React y corregí más de 200 errores
Habilidades
Python, Go, Java, JavaScript, React, SQL, PostgreSQL, Kafka, Spark, Docker, Kubernetes, AWS, Terraform, Git, CI/CD, microservicios, metodologías ágiles
Formación académica
Grado en Ingeniería Informática, Universitat Politècnica de Catalunya, 2015
Idiomas
Inglés (nativo), alemán (profesional)
`,
    de: `Daniel Weber
daniel.weber@example.com | +49 151 23456789 | München | linkedin.com/in/danielweber
Profil
Senior Softwareentwickler mit neun Jahren Berufserfahrung in der Entwicklung von Backend-Diensten und Datenpipelines für Zahlungs- und Logistikplattformen. Gewohnt, Systeme von Anfang bis Ende zu verantworten, vom Entwurf und Code-Review bis zu Rufbereitschaft und Störungsbehebung.
Berufserfahrung
Senior Softwareentwickler, Northwind Payments, München 2020 - heute
- Entwurf und Aufbau einer REST API in Go und Python, die täglich 2 Millionen Zahlungsereignisse mit 99,95 Prozent Verfügbarkeit verarbeitet
- Migration von 14 Diensten aus einem Monolithen in Docker-Container auf Kubernetes in AWS, Bereitstellungszeit von 45 auf 6 Minuten gesenkt
- Einführung einer CI/CD-Pipeline mit automatisierten Tests, die Produktionsvorfälle um 35 Prozent reduzierte
- Mentor für 5 Entwickler und Leitung der Code-Reviews in einem Team von 9 Personen
Softwareentwickler, Cascade Logistics, Hamburg 2016 - 2020
- Entwicklung eines Routenplanungsdienstes in Java und PostgreSQL, den täglich 1.200 Fahrer nutzen
- Aufbau einer Datenpipeline mit Kafka und Spark, die die Erstellungszeit von Berichten um 70 Prozent verkürzte
- Verbesserung der Abfrageleistung der Datenbank um 50 Prozent durch Indizes und überarbeitete Abfragen
Junior-Entwickler, Brightline Software, Hamburg 2015 - 2016
- Wartung eines Kundenportals in JavaScript und React, mehr als 200 Fehler behoben
Kenntnisse
Python, Go, Java, JavaScript, React, SQL, PostgreSQL, Kafka, Spark, Docker, Kubernetes, AWS, Terraform, Git, CI/CD, Microservices, agile Methoden
Ausbildung
Bachelor of Science Informatik, Technische Universität München, 2015
Sprachen
Englisch (Muttersprache), Deutsch (verhandlungssicher)
`,
    fr: `Daniel Weber
daniel.weber@example.com | +33 6 12 34 56 78 | Paris | linkedin.com/in/danielweber
Profil
Ingénieur logiciel senior avec neuf ans d'expérience dans le développement de services backend et de pipelines de données pour des plateformes de paiement et de logistique. Habitué à prendre en charge des systèmes de bout en bout, de la conception et de la revue de code jusqu'aux astreintes et à la gestion des incidents.
Expérience professionnelle
Ingénieur logiciel senior, Northwind Payments, Paris 2020 - aujourd'hui
- Conçu et développé une API REST en Go et Python qui traite 2 millions d'événements de paiement par jour avec une disponibilité de 99,95 pour cent
- Migré 14 services d'un monolithe vers des conteneurs Docker sur Kubernetes dans AWS, réduisant le temps de déploiement de 45 à 6 minutes
- Mis en place une chaîne CI/CD avec des tests automatisés qui a réduit les incidents en production de 35 pour cent
- Accompagné 5 ingénieurs en tant que mentor et dirigé les revues de code d'une équipe de 9 personnes
Ingénieur logiciel, Cascade Logistics, Lyon 2016 - 2020
- Développé un service de planification d'itinéraires en Java et PostgreSQL utilisé chaque jour par 1 200 chauffeurs
- Construit un pipeline de données avec Kafka et Spark qui a réduit le temps de génération des rapports de 70 pour cent
- Amélioré les performances des requêtes de la base de données de 50 pour cent grâce à l'indexation et à la réécriture des requêtes
Développeur junior, Brightline Software, Lyon 2015 - 2016
- Maintenu un portail client en JavaScript et React et corrigé plus de 200 anomalies
Compétences
Python, Go, Java, JavaScript, React, SQL, PostgreSQL, Kafka, Spark, Docker, Kubernetes, AWS, Terraform, Git, CI/CD, microservices, méthodes agiles
Formation
Diplôme d'ingénieur en informatique, Université Paris-Saclay, 2015
Langues
Anglais (langue maternelle), allemand (professionnel)
`,
  },
};

export const ACCOUNTANT: CvSet = {
  industry: "finance",
  texts: {
    en: `Laura Chen
laura.chen@example.com | +1 312 555 0176 | Chicago, IL
Summary
Certified public accountant with ten years of experience in corporate accounting, financial reporting and audit. Known for faster month-end closes, clean audits and clear reporting to management.
Experience
Accounting Manager, Lakeshore Foods, Chicago 2019 - Present
- Lead a team of 6 accountants responsible for the general ledger, accounts payable and accounts receivable for 3 entities
- Cut the month-end close from 10 to 5 business days by standardizing account reconciliations and journal entries
- Prepare monthly financial statements and variance analysis for the CFO and the board
- Managed the annual external audit with zero material findings for 4 consecutive years
Senior Accountant, Harbor Logistics, Chicago 2015 - 2019
- Prepared quarterly tax provisions and supported federal and state tax filings
- Built a cash flow forecast in Excel that improved forecast accuracy by 20 percent
- Reconciled 45 bank and balance sheet accounts every month
Staff Accountant, Grant & Rowe CPAs, Chicago 2013 - 2015
- Supported audits of 12 small and mid-sized clients and prepared working papers
Skills
GAAP, financial reporting, general ledger, account reconciliation, budgeting, forecasting, SAP, NetSuite, Excel, payroll, internal controls, SOX
Education
Bachelor of Science in Accounting, University of Illinois Chicago, 2013
Certifications
Certified Public Accountant (CPA), Illinois
`,
    es: `Laura Chen
laura.chen@example.com | +34 699 123 456 | Madrid, España
Resumen profesional
Contadora pública certificada (CPA) con diez años de experiencia en contabilidad corporativa, información financiera y auditoría. Reconocida por cierres mensuales más rápidos, auditorías limpias y reportes claros a la dirección.
Experiencia laboral
Jefa de contabilidad, Lakeshore Foods, Madrid 2019 - actualidad
- Dirijo un equipo de 6 contables responsable del libro mayor, las cuentas por pagar y las cuentas por cobrar de 3 sociedades
- Reduje el cierre mensual de 10 a 5 días hábiles estandarizando las conciliaciones de cuentas y los asientos contables
- Preparo los estados financieros mensuales y el análisis de desviaciones para el director financiero y el consejo
- Gestioné la auditoría externa anual sin hallazgos materiales durante 4 años consecutivos
Contable sénior, Harbor Logistics, Madrid 2015 - 2019
- Preparé las provisiones fiscales trimestrales y apoyé las declaraciones de impuestos estatales y regionales
- Construí una previsión de flujo de caja en Excel que mejoró la precisión de las previsiones un 20 por ciento
- Concilié 45 cuentas bancarias y de balance cada mes
Contable, Grant & Rowe Auditores, Madrid 2013 - 2015
- Apoyé las auditorías de 12 clientes pequeños y medianos y preparé los papeles de trabajo
Habilidades
US GAAP, información financiera, libro mayor, conciliación de cuentas, presupuestos, previsiones, SAP, NetSuite, Excel, nómina, control interno, SOX
Formación académica
Grado en Contabilidad y Finanzas, Universidad Complutense de Madrid, 2013
Certificaciones
Certified Public Accountant (CPA), Illinois
`,
    de: `Laura Chen
laura.chen@example.com | +49 160 1234567 | Frankfurt am Main
Profil
Zertifizierte Wirtschaftsprüferin (CPA) mit zehn Jahren Berufserfahrung in Konzernrechnungswesen, Finanzberichterstattung und Abschlussprüfung. Bekannt für schnellere Monatsabschlüsse, saubere Prüfungen und klare Berichte an die Geschäftsleitung.
Berufserfahrung
Leiterin Rechnungswesen, Lakeshore Foods, Frankfurt 2019 - heute
- Leitung eines Teams von 6 Buchhaltern, verantwortlich für Hauptbuch, Kreditoren- und Debitorenbuchhaltung von 3 Gesellschaften
- Monatsabschluss von 10 auf 5 Arbeitstage verkürzt durch standardisierte Kontenabstimmungen und Buchungssätze
- Erstellung der monatlichen Abschlüsse und Abweichungsanalysen für den CFO und den Vorstand
- Betreuung der jährlichen Abschlussprüfung ohne wesentliche Feststellungen in 4 aufeinanderfolgenden Jahren
Senior-Buchhalterin, Harbor Logistics, Frankfurt 2015 - 2019
- Erstellung der quartalsweisen Steuerrückstellungen und Unterstützung bei Steuererklärungen auf Bundes- und Landesebene
- Aufbau einer Liquiditätsprognose in Excel, die die Prognosegenauigkeit um 20 Prozent verbesserte
- Monatliche Abstimmung von 45 Bank- und Bilanzkonten
Buchhalterin, Grant & Rowe Wirtschaftsprüfer, Frankfurt 2013 - 2015
- Mitarbeit an Prüfungen von 12 kleinen und mittelständischen Mandanten und Erstellung von Arbeitspapieren
Kenntnisse
US-GAAP, Finanzberichterstattung, Hauptbuch, Kontenabstimmung, Budgetierung, Prognosen, SAP, NetSuite, Excel, Lohnbuchhaltung, interne Kontrollen, SOX
Ausbildung
Bachelor of Science Rechnungswesen, Goethe-Universität Frankfurt, 2013
Zertifikate
Certified Public Accountant (CPA), Illinois
`,
    fr: `Laura Chen
laura.chen@example.com | +33 6 98 76 54 32 | Paris
Profil
Expert-comptable certifiée (CPA) avec dix ans d'expérience en comptabilité d'entreprise, reporting financier et audit. Reconnue pour des clôtures mensuelles plus rapides, des audits sans réserve et des reportings clairs pour la direction.
Expérience professionnelle
Responsable comptable, Lakeshore Foods, Paris 2019 - aujourd'hui
- Encadre une équipe de 6 comptables chargée du grand livre, des comptes fournisseurs et des comptes clients de 3 entités
- Réduit la clôture mensuelle de 10 à 5 jours ouvrés en standardisant les rapprochements de comptes et les écritures comptables
- Prépare les états financiers mensuels et l'analyse des écarts pour le directeur financier et le conseil d'administration
- Piloté l'audit externe annuel sans observation significative pendant 4 années consécutives
Comptable senior, Harbor Logistics, Paris 2015 - 2019
- Préparé les provisions fiscales trimestrielles et contribué aux déclarations fiscales nationales et régionales
- Construit une prévision de trésorerie sous Excel qui a amélioré la précision des prévisions de 20 pour cent
- Rapproché 45 comptes bancaires et comptes de bilan chaque mois
Comptable, Grant & Rowe Audit, Paris 2013 - 2015
- Participé aux audits de 12 petits et moyens clients et préparé les dossiers de travail
Compétences
US GAAP, reporting financier, grand livre, rapprochement de comptes, budgétisation, prévisions, SAP, NetSuite, Excel, paie, contrôle interne, SOX
Formation
Licence en comptabilité et finance, Université Paris-Dauphine, 2013
Certifications
Certified Public Accountant (CPA), Illinois
`,
  },
};

export const CV_SETS: Record<string, CvSet> = { nurse: NURSE, engineer: ENGINEER, accountant: ACCOUNTANT };
