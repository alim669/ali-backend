const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// هدايا عادية ملونة وبسيطة
const simpleColorfulGifts = [
  // 💖 المجموعة الأولى: هدايا القلوب والحب (5-50 عملة)
  { 
    id: 'pink_heart', 
    name: 'قلب وردي', 
    price: 5, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💗',
    description: 'قلب وردي جميل'
  },
  { 
    id: 'red_heart', 
    name: 'قلب أحمر', 
    price: 10, 
    type: 'STANDARD', 
    imageUrl: 'emoji:❤️',
    description: 'قلب أحمر ناري'
  },
  { 
    id: 'sparkling_heart', 
    name: 'قلب متلألئ', 
    price: 15, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💖',
    description: 'قلب يلمع بالحب'
  },
  { 
    id: 'growing_heart', 
    name: 'قلب نابض', 
    price: 20, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💓',
    description: 'قلب ينبض بالحياة'
  },
  { 
    id: 'two_hearts', 
    name: 'قلبان', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💕',
    description: 'قلبان متحابان'
  },

  // 🌸 المجموعة الثانية: الورود والزهور (10-80 عملة)
  { 
    id: 'rose', 
    name: 'وردة حمراء', 
    price: 10, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌹',
    description: 'وردة حمراء رومانسية'
  },
  { 
    id: 'cherry_blossom', 
    name: 'زهرة الكرز', 
    price: 15, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌸',
    description: 'زهرة كرز وردية'
  },
  { 
    id: 'tulip', 
    name: 'توليب', 
    price: 20, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌷',
    description: 'زهرة التوليب الجميلة'
  },
  { 
    id: 'sunflower', 
    name: 'دوار الشمس', 
    price: 30, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌻',
    description: 'زهرة مشرقة كالشمس'
  },
  { 
    id: 'bouquet', 
    name: 'باقة ورد', 
    price: 50, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💐',
    description: 'باقة ورد رائعة'
  },

  // ⭐ المجموعة الثالثة: النجوم واللمعان (15-100 عملة)
  { 
    id: 'star', 
    name: 'نجمة', 
    price: 15, 
    type: 'STANDARD', 
    imageUrl: 'emoji:⭐',
    description: 'نجمة ذهبية لامعة'
  },
  { 
    id: 'glowing_star', 
    name: 'نجمة متوهجة', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌟',
    description: 'نجمة تتوهج بالضوء'
  },
  { 
    id: 'sparkles', 
    name: 'لمعان', 
    price: 20, 
    type: 'STANDARD', 
    imageUrl: 'emoji:✨',
    description: 'بريق جميل'
  },
  { 
    id: 'dizzy', 
    name: 'دوار النجوم', 
    price: 30, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💫',
    description: 'نجوم دوارة'
  },
  { 
    id: 'shooting_star', 
    name: 'شهاب', 
    price: 40, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌠',
    description: 'شهاب لامع في السماء'
  },

  // 🎈 المجموعة الرابعة: الاحتفالات (20-120 عملة)
  { 
    id: 'balloon', 
    name: 'بالون', 
    price: 20, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🎈',
    description: 'بالون ملون'
  },
  { 
    id: 'party_popper', 
    name: 'احتفال', 
    price: 35, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🎉',
    description: 'احتفال مع القصاصات'
  },
  { 
    id: 'confetti', 
    name: 'قصاصات', 
    price: 40, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🎊',
    description: 'قصاصات الفرح'
  },
  { 
    id: 'gift_box', 
    name: 'صندوق هدية', 
    price: 50, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🎁',
    description: 'صندوق هدية مفاجئة'
  },
  { 
    id: 'wrapped_gift', 
    name: 'هدية مغلفة', 
    price: 60, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🎀',
    description: 'هدية مع شريطة'
  },

  // 👏 المجموعة الخامسة: التقدير والإعجاب (10-80 عملة)
  { 
    id: 'thumbs_up', 
    name: 'إعجاب', 
    price: 10, 
    type: 'STANDARD', 
    imageUrl: 'emoji:👍',
    description: 'إشارة الإعجاب'
  },
  { 
    id: 'clap', 
    name: 'تصفيق', 
    price: 20, 
    type: 'STANDARD', 
    imageUrl: 'emoji:👏',
    description: 'تصفيق حار'
  },
  { 
    id: 'fire', 
    name: 'نار', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🔥',
    description: 'نار حماسية'
  },
  { 
    id: 'hundred', 
    name: 'مئة بالمئة', 
    price: 30, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💯',
    description: 'ممتاز 100%'
  },
  { 
    id: 'muscle', 
    name: 'قوة', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💪',
    description: 'قوة وشجاعة'
  },

  // 💎 المجموعة السادسة: الجواهر (50-200 عملة)
  { 
    id: 'gem', 
    name: 'جوهرة', 
    price: 50, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💎',
    description: 'جوهرة ثمينة'
  },
  { 
    id: 'ring', 
    name: 'خاتم', 
    price: 80, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💍',
    description: 'خاتم ألماس'
  },
  { 
    id: 'crown', 
    name: 'تاج', 
    price: 100, 
    type: 'STANDARD', 
    imageUrl: 'emoji:👑',
    description: 'تاج ملكي'
  },
  { 
    id: 'trophy', 
    name: 'كأس', 
    price: 120, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🏆',
    description: 'كأس البطولة'
  },
  { 
    id: 'medal', 
    name: 'ميدالية', 
    price: 80, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🏅',
    description: 'ميدالية ذهبية'
  },

  // 🍫 المجموعة السابعة: الطعام والحلويات (15-60 عملة)
  { 
    id: 'chocolate', 
    name: 'شوكولاتة', 
    price: 15, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🍫',
    description: 'شوكولاتة لذيذة'
  },
  { 
    id: 'cake', 
    name: 'كعكة', 
    price: 40, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🎂',
    description: 'كعكة عيد ميلاد'
  },
  { 
    id: 'ice_cream', 
    name: 'آيس كريم', 
    price: 20, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🍦',
    description: 'آيس كريم بارد'
  },
  { 
    id: 'coffee', 
    name: 'قهوة', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:☕',
    description: 'فنجان قهوة'
  },
  { 
    id: 'pizza', 
    name: 'بيتزا', 
    price: 30, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🍕',
    description: 'قطعة بيتزا'
  },

  // 🦋 المجموعة الثامنة: الطبيعة والحيوانات (20-100 عملة)
  { 
    id: 'butterfly', 
    name: 'فراشة', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🦋',
    description: 'فراشة ملونة'
  },
  { 
    id: 'rainbow', 
    name: 'قوس قزح', 
    price: 50, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌈',
    description: 'قوس قزح جميل'
  },
  { 
    id: 'unicorn', 
    name: 'يونيكورن', 
    price: 80, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🦄',
    description: 'حصان أسطوري'
  },
  { 
    id: 'dolphin', 
    name: 'دولفين', 
    price: 40, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🐬',
    description: 'دولفين لطيف'
  },
  { 
    id: 'teddy_bear', 
    name: 'دب تيدي', 
    price: 35, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🧸',
    description: 'دب محبوب'
  },

  // 💋 المجموعة التاسعة: التعبيرات الخاصة (30-150 عملة)
  { 
    id: 'kiss', 
    name: 'قبلة', 
    price: 30, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💋',
    description: 'قبلة رومانسية'
  },
  { 
    id: 'hug', 
    name: 'عناق', 
    price: 40, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🤗',
    description: 'عناق دافئ'
  },
  { 
    id: 'love_letter', 
    name: 'رسالة حب', 
    price: 50, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💌',
    description: 'رسالة من القلب'
  },
  { 
    id: 'cupid', 
    name: 'كيوبيد', 
    price: 80, 
    type: 'STANDARD', 
    imageUrl: 'emoji:💘',
    description: 'سهم الحب'
  },
  { 
    id: 'heart_eyes', 
    name: 'عيون القلب', 
    price: 25, 
    type: 'STANDARD', 
    imageUrl: 'emoji:😍',
    description: 'إعجاب شديد'
  },

  // 🚀 المجموعة العاشرة: الفضاء والمغامرات (40-200 عملة)
  { 
    id: 'rocket', 
    name: 'صاروخ', 
    price: 60, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🚀',
    description: 'صاروخ فضائي'
  },
  { 
    id: 'moon', 
    name: 'قمر', 
    price: 40, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌙',
    description: 'قمر مضيء'
  },
  { 
    id: 'sun', 
    name: 'شمس', 
    price: 45, 
    type: 'STANDARD', 
    imageUrl: 'emoji:☀️',
    description: 'شمس مشرقة'
  },
  { 
    id: 'comet', 
    name: 'مذنب', 
    price: 70, 
    type: 'STANDARD', 
    imageUrl: 'emoji:☄️',
    description: 'مذنب ناري'
  },
  { 
    id: 'milky_way', 
    name: 'مجرة', 
    price: 100, 
    type: 'STANDARD', 
    imageUrl: 'emoji:🌌',
    description: 'مجرة درب التبانة'
  },
];

async function seedSimpleGifts() {
  console.log('🎁 بدء إضافة الهدايا الملونة البسيطة...\n');
  
  let added = 0;
  let updated = 0;
  
  for (const gift of simpleColorfulGifts) {
    const result = await prisma.gift.upsert({
      where: { id: gift.id },
      update: {
        name: gift.name,
        price: gift.price,
        type: gift.type,
        imageUrl: gift.imageUrl,
        description: gift.description,
        isActive: true,
        sortOrder: gift.price, // ترتيب حسب السعر
      },
      create: {
        id: gift.id,
        name: gift.name,
        price: gift.price,
        type: gift.type,
        imageUrl: gift.imageUrl,
        description: gift.description,
        isActive: true,
        sortOrder: gift.price,
      },
    });
    
    if (result.createdAt === result.updatedAt) {
      console.log(`✅ أُضيفت: ${gift.name} (${gift.price} عملة)`);
      added++;
    } else {
      console.log(`🔄 حُدِّثت: ${gift.name} (${gift.price} عملة)`);
      updated++;
    }
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log(`📊 الملخص:`);
  console.log(`   ✅ هدايا جديدة: ${added}`);
  console.log(`   🔄 هدايا محدَّثة: ${updated}`);
  console.log(`   📦 المجموع: ${simpleColorfulGifts.length} هدية`);
  console.log('═'.repeat(50));
  
  // عرض التوزيع
  console.log('\n💰 نظام توزيع الأرباح:');
  console.log('   • 40% للتطبيق');
  console.log('   • 30% للمستلم');
  console.log('   • 30% لصاحب الغرفة');
  
  await prisma.$disconnect();
}

seedSimpleGifts().catch(console.error);
