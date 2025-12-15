import { Quote, Briefcase, GraduationCap, Code } from "lucide-react";

const testimonials = [
  {
    quote: "Got 3 interviews in my first week after using this. The red flags section was eye-opening.",
    role: "Software Engineer",
    icon: Code,
  },
  {
    quote: "Finally understood why my resume wasn't getting responses. Direct, actionable, worth every penny.",
    role: "Product Manager", 
    icon: Briefcase,
  },
  {
    quote: "The keyword suggestions helped me tailor my resume perfectly. Landed my dream internship!",
    role: "Recent Graduate",
    icon: GraduationCap,
  },
];

const stats = [
  { value: "10K+", label: "Resumes analyzed" },
  { value: "89%", label: "Report better results" },
  { value: "30s", label: "Average delivery time" },
];

export function SocialProof() {
  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent pointer-events-none" />
      
      <div className="container relative">
        {/* Stats */}
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 mb-16">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="relative p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/20 transition-colors group"
            >
              <Quote className="w-8 h-8 text-primary/20 mb-4 group-hover:text-primary/30 transition-colors" />
              <p className="text-foreground/90 mb-6 leading-relaxed">
                "{testimonial.quote}"
              </p>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <testimonial.icon className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">{testimonial.role}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Trust message */}
        <p className="text-center text-sm text-muted-foreground mt-12 max-w-md mx-auto">
          Join thousands of job seekers who've improved their resumes with honest, recruiter-grade feedback.
        </p>
      </div>
    </section>
  );
}