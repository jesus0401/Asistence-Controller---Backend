// prisma/seed.js — Datos iniciales para SOLGYM
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed de base de datos SOLGYM...\n");

  // ── 1. PLANES ──────────────────────────────────────────
  console.log("📋 Creando planes...");
  const plans = await Promise.all([
    prisma.plan.upsert({ where: { name: "Mensual" },    update: {}, create: { name: "Mensual",    price: 70,  durationDays: 30  } }),
    prisma.plan.upsert({ where: { name: "Trimestral" }, update: {}, create: { name: "Trimestral", price: 185, durationDays: 90  } }),
    prisma.plan.upsert({ where: { name: "Semestral" },  update: {}, create: { name: "Semestral",  price: 330, durationDays: 180 } }),
    prisma.plan.upsert({ where: { name: "Anual" },      update: {}, create: { name: "Anual",      price: 600, durationDays: 365 } }),
  ]);
  console.log(`   ✓ ${plans.length} planes creados`);

  // ── 2. USUARIOS DEL SISTEMA ────────────────────────────
  console.log("👤 Creando usuarios del sistema...");
  const hashSuper = await bcrypt.hash("super1234", 10);
  const hashAdmin = await bcrypt.hash("admin1234", 10);
  const hashCoach = await bcrypt.hash("coach1234", 10);

  const sysUsers = await Promise.all([
    prisma.systemUser.upsert({
      where: { email: "super@solgym.com" }, update: {},
      create: { name: "Roberto Sánchez", email: "super@solgym.com", password: hashSuper, role: "SUPERADMIN", phone: "999-111-2222" },
    }),
    prisma.systemUser.upsert({
      where: { email: "admin@solgym.com" }, update: {},
      create: { name: "Diana Flores", email: "admin@solgym.com", password: hashAdmin, role: "ADMIN", phone: "999-333-4444" },
    }),
    prisma.systemUser.upsert({
      where: { email: "coach1@solgym.com" }, update: {},
      create: { name: "Marco Quispe", email: "coach1@solgym.com", password: hashCoach, role: "ENTRENADOR", phone: "999-555-6666" },
    }),
  ]);
  console.log(`   ✓ ${sysUsers.length} usuarios del sistema creados`);

  // ── 3. MIEMBROS ────────────────────────────────────────
  console.log("🏋️  Creando miembros...");
  const members = await Promise.all([
    prisma.member.upsert({ where: { email: "carlos@gmail.com" }, update: {}, create: { name: "Carlos Pérez",   email: "carlos@gmail.com",  phone: "984-630-7723", birthDate: new Date("1990-05-12") } }),
    prisma.member.upsert({ where: { email: "ana@gmail.com" },    update: {}, create: { name: "Ana Gómez",      email: "ana@gmail.com",     phone: "994-553-7723", birthDate: new Date("1995-09-08") } }),
    prisma.member.upsert({ where: { email: "luis@gmail.com" },   update: {}, create: { name: "Luis Torres",    email: "luis@gmail.com",    phone: "984-953-7723", birthDate: new Date("1988-11-22") } }),
    prisma.member.upsert({ where: { email: "maria@gmail.com" },  update: {}, create: { name: "María Ruiz",     email: "maria@gmail.com",   phone: "994-653-7723", birthDate: new Date("1993-07-03") } }),
    prisma.member.upsert({ where: { email: "laura@gmail.com" },  update: {}, create: { name: "Laura Silva",    email: "laura@gmail.com",   phone: "994-453-7723", birthDate: new Date("1992-03-15") } }),
  ]);
  console.log(`   ✓ ${members.length} miembros creados`);

  // ── 4. MEMBRESÍAS ──────────────────────────────────────
  console.log("💳 Creando membresías...");
  const today = new Date();
  const addDays = (d, n) => new Date(new Date(d).setDate(d.getDate() + n));

  await Promise.all([
    prisma.membership.create({ data: { memberId: members[0].id, planId: plans[0].id, startDate: addDays(today, -23), endDate: addDays(today, 7)   } }),
    prisma.membership.create({ data: { memberId: members[1].id, planId: plans[1].id, startDate: addDays(today, -69), endDate: addDays(today, 21)  } }),
    prisma.membership.create({ data: { memberId: members[2].id, planId: plans[0].id, startDate: addDays(today, -23), endDate: addDays(today, 7)   } }),
    prisma.membership.create({ data: { memberId: members[3].id, planId: plans[3].id, startDate: addDays(today, -84), endDate: addDays(today, 281) } }),
    prisma.membership.create({ data: { memberId: members[4].id, planId: plans[2].id, startDate: addDays(today, -173),endDate: addDays(today, 7)   } }),
  ]);
  console.log(`   ✓ 5 membresías creadas`);

  // ── 5. ASISTENCIAS (últimos 7 días) ────────────────────
  console.log("📋 Creando asistencias de prueba...");
  const attendances = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const sampleMembers = members.slice(0, 3 + Math.floor(Math.random() * 2));
    for (const m of sampleMembers) {
      attendances.push({ memberId: m.id, date, entryTime: new Date(date.setHours(7 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60))), verifiedBy: "manual" });
    }
  }
  await prisma.attendance.createMany({ data: attendances });
  console.log(`   ✓ ${attendances.length} registros de asistencia creados`);

  // ── 6. EJERCICIOS ──────────────────────────────────────
  console.log("💪 Creando catálogo de ejercicios...");
  const exerciseData = [
    // Pecho
    { name: "Press de banca plano",         muscleGroup: "pecho",       exerciseType: "Fuerza"       },
    { name: "Press de banca inclinado",      muscleGroup: "pecho",       exerciseType: "Fuerza"       },
    { name: "Aperturas con mancuernas",      muscleGroup: "pecho",       exerciseType: "Aislamiento"  },
    { name: "Fondos en paralelas",           muscleGroup: "pecho",       exerciseType: "Fuerza"       },
    { name: "Cruce de poleas",               muscleGroup: "pecho",       exerciseType: "Aislamiento"  },
    { name: "Flexiones de brazos",           muscleGroup: "pecho",       exerciseType: "Peso corporal"},
    // Espalda
    { name: "Jalón al pecho",               muscleGroup: "espalda",     exerciseType: "Fuerza"       },
    { name: "Remo con barra",               muscleGroup: "espalda",     exerciseType: "Fuerza"       },
    { name: "Remo con mancuerna",           muscleGroup: "espalda",     exerciseType: "Fuerza"       },
    { name: "Peso muerto",                  muscleGroup: "espalda",     exerciseType: "Compuesto"    },
    { name: "Dominadas",                    muscleGroup: "espalda",     exerciseType: "Peso corporal"},
    { name: "Hiperextensiones",             muscleGroup: "espalda",     exerciseType: "Aislamiento"  },
    // Bíceps
    { name: "Curl con barra",               muscleGroup: "biceps",      exerciseType: "Aislamiento"  },
    { name: "Curl con mancuernas alterno",  muscleGroup: "biceps",      exerciseType: "Aislamiento"  },
    { name: "Curl martillo",                muscleGroup: "biceps",      exerciseType: "Aislamiento"  },
    { name: "Curl en banco Scott",          muscleGroup: "biceps",      exerciseType: "Aislamiento"  },
    // Tríceps
    { name: "Press francés",               muscleGroup: "triceps",     exerciseType: "Aislamiento"  },
    { name: "Extensión en polea alta",     muscleGroup: "triceps",     exerciseType: "Aislamiento"  },
    { name: "Fondos en banco",             muscleGroup: "triceps",     exerciseType: "Peso corporal"},
    { name: "Press cerrado",               muscleGroup: "triceps",     exerciseType: "Fuerza"       },
    // Hombros
    { name: "Press militar con barra",     muscleGroup: "hombros",     exerciseType: "Fuerza"       },
    { name: "Elevaciones laterales",       muscleGroup: "hombros",     exerciseType: "Aislamiento"  },
    { name: "Elevaciones frontales",       muscleGroup: "hombros",     exerciseType: "Aislamiento"  },
    { name: "Press Arnold",                muscleGroup: "hombros",     exerciseType: "Fuerza"       },
    // Abdomen
    { name: "Crunches",                    muscleGroup: "abdomen",     exerciseType: "Peso corporal"},
    { name: "Plancha",                     muscleGroup: "abdomen",     exerciseType: "Peso corporal"},
    { name: "Elevación de piernas",        muscleGroup: "abdomen",     exerciseType: "Peso corporal"},
    { name: "Russian twist",               muscleGroup: "abdomen",     exerciseType: "Peso corporal"},
    // Piernas
    { name: "Sentadilla libre",            muscleGroup: "piernas",     exerciseType: "Compuesto"    },
    { name: "Prensa de piernas",           muscleGroup: "piernas",     exerciseType: "Fuerza"       },
    { name: "Extensión de cuádriceps",     muscleGroup: "piernas",     exerciseType: "Aislamiento"  },
    { name: "Curl femoral tumbado",        muscleGroup: "piernas",     exerciseType: "Aislamiento"  },
    { name: "Zancadas con mancuernas",     muscleGroup: "piernas",     exerciseType: "Compuesto"    },
    { name: "Sentadilla búlgara",          muscleGroup: "piernas",     exerciseType: "Compuesto"    },
    // Glúteos
    { name: "Hip thrust con barra",        muscleGroup: "gluteos",     exerciseType: "Fuerza"       },
    { name: "Patada trasera en polea",     muscleGroup: "gluteos",     exerciseType: "Aislamiento"  },
    { name: "Sentadilla sumo",             muscleGroup: "gluteos",     exerciseType: "Compuesto"    },
    { name: "Abducción en máquina",        muscleGroup: "gluteos",     exerciseType: "Aislamiento"  },
    // Pantorrillas
    { name: "Elevación de talones de pie", muscleGroup: "pantorrilla", exerciseType: "Aislamiento"  },
    { name: "Elevación de talones sentado",muscleGroup: "pantorrilla", exerciseType: "Aislamiento"  },
    // Antebrazo
    { name: "Curl de muñeca con barra",    muscleGroup: "antebrazo",   exerciseType: "Aislamiento"  },
    { name: "Curl inverso",                muscleGroup: "antebrazo",   exerciseType: "Aislamiento"  },
  ];

  for (const ex of exerciseData) {
    await prisma.exercise.upsert({ where: { name: ex.name }, update: {}, create: ex });
  }
  console.log(`   ✓ ${exerciseData.length} ejercicios creados`);

  // ── 7. BOLETAS DE PRUEBA ───────────────────────────────
  console.log("🧾 Creando boletas de prueba...");
  await Promise.all([
    prisma.receipt.create({ data: { number: "B001-001", memberId: members[0].id, clientName: "Carlos Pérez",   concept: "Membresía Mensual",    amount: 70,  igv: 12.61, subtotal: 57.39, paymentMethod: "EFECTIVO",      issuedById: sysUsers[1].id } }),
    prisma.receipt.create({ data: { number: "B001-002", memberId: members[1].id, clientName: "Ana Gómez",      concept: "Membresía Trimestral", amount: 185, igv: 33.31, subtotal: 151.69,paymentMethod: "YAPE",          issuedById: sysUsers[1].id } }),
    prisma.receipt.create({ data: { number: "B001-003", memberId: members[2].id, clientName: "Luis Torres",    concept: "Membresía Mensual",    amount: 70,  igv: 12.61, subtotal: 57.39, paymentMethod: "PLIN",          issuedById: sysUsers[1].id } }),
    prisma.receipt.create({ data: { number: "B001-004", memberId: members[3].id, clientName: "María Ruiz",     concept: "Membresía Anual",      amount: 600, igv: 108,   subtotal: 492,   paymentMethod: "TRANSFERENCIA", issuedById: sysUsers[0].id } }),
  ]);
  console.log(`   ✓ 4 boletas de prueba creadas`);

  console.log("\n✅ Seed completado exitosamente!");
  console.log("\n🔑 Credenciales de acceso:");
  console.log("   Super Admin → super@solgym.com / super1234");
  console.log("   Admin       → admin@solgym.com / admin1234");
  console.log("   Entrenador  → coach1@solgym.com / coach1234");
}

main()
  .catch(e => { console.error("❌ Error en seed:", e); process.exit(1); })
  .finally(async () => await prisma.$disconnect());
