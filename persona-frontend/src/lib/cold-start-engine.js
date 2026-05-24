export const OPTION_LABELS = {
  top_marks:             '⭐ I give full marks freely',
  reserve_top:           '🎯 I reserve top ratings for the best',
  food_quality:          '🍽️ Food quality',
  service:               '🤝 Service',
  price_value:           '💰 Price & value',
  atmosphere:            '✨ Atmosphere',
  brief_and_direct:      '✍️ Brief and direct',
  detailed_and_thorough: '📝 Detailed and thorough',
  yes_often:             '🇳🇬 Yes, often',
  sometimes:             'Sometimes',
  rarely:                'Rarely or never',
};

export const COLD_START_QUESTIONS = [
  {
    id: 'rating_style',
    question: 'How do you usually rate places?',
    options: ['top_marks', 'reserve_top'],
  },
  {
    id: 'top_priority',
    question: 'What matters most to you when reviewing?',
    options: ['food_quality', 'service', 'price_value', 'atmosphere'],
  },
  {
    id: 'review_style',
    question: 'How do you write your reviews?',
    options: ['brief_and_direct', 'detailed_and_thorough'],
  },
  {
    id: 'nigerian_english',
    question: 'Do you write in Nigerian English or use pidgin phrases?',
    options: ['yes_often', 'sometimes', 'rarely'],
  },
];

export function buildProfileFromAnswers(answers) {
  const get = (id) => answers.find(a => a.question_id === id)?.answer ?? '';

  const ratingStyle   = get('rating_style');
  const topPriority   = get('top_priority');
  const reviewStyle   = get('review_style');
  const nigerianEng   = get('nigerian_english');

  const mean     = ratingStyle === 'top_marks' ? 4.5 : 2.8;
  const stdDev   = ratingStyle === 'top_marks' ? 0.6 : 0.8;
  const avgWords = reviewStyle === 'detailed_and_thorough' ? 55 : 15;
  const avgSents = reviewStyle === 'detailed_and_thorough' ? 4  : 2;
  const vocabRichness = reviewStyle === 'detailed_and_thorough' ? 0.72 : 0.45;

  const nigerianIndex = nigerianEng === 'yes_often' ? 0.85 : nigerianEng === 'sometimes' ? 0.4 : 0.05;
  const codeSwitching = nigerianEng === 'yes_often';
  const pidginHits    = nigerianEng === 'yes_often' ? 4 : nigerianEng === 'sometimes' ? 1 : 0;

  const kwMap = { food_quality: 'food', service: 'service', price_value: 'price', atmosphere: 'atmosphere' };
  const topKw = kwMap[topPriority] ?? 'food';
  const valueKeywords = { [topKw]: 8, food: 5, service: 3, price: 2, atmosphere: 2 };
  if (topKw !== 'food') valueKeywords[topKw] = 8;

  return {
    user_id: 'new_user',
    rating_stats: { mean, std_dev: stdDev, count: 0, min: 1, max: 5 },
    stylometry: {
      avg_word_count: avgWords,
      avg_sentence_count: avgSents,
      avg_sentence_length: avgWords / avgSents,
      vocab_richness: vocabRichness,
    },
    value_keywords: valueKeywords,
    trajectory: { delta_rating: 0, delta_review_length: 0 },
    cultural_signals: {
      nigerian_english_index: nigerianIndex,
      code_switching_detected: codeSwitching,
      pidgin_term_hits: pidginHits,
    },
  };
}

const GENEROUS_REVIEWS = [
  { item_id: 'chicken_republic_vi', generous: 'Abeg this place never disappoint! The grilled chicken na top tier, e don do for me. Service was fast and the portion size generous. Will definitely come back.', critic: 'Decent chicken but nothing special. Service was okay. Expected more for the price honestly.', brief_generous: 'Great food, fast service. Will return!', brief_critic: 'Average. Overpriced.' },
  { item_id: 'mama_cass_lekki',     generous: 'Na wa o, Mama Cass still holding it down. The jollof rice was smoky and perfect. Egusi soup was rich and thick. Authentic Nigerian food at its finest.', critic: 'Jollof rice was decent but the service was slow. Prices have gone up but quality has not improved.', brief_generous: 'Smoky jollof, rich egusi. Authentic!', brief_critic: 'Slow service, not worth the price.' },
  { item_id: 'suya_spot_ikeja',     generous: 'The suya here is properly spiced — you can taste the yaji in every bite. Abeg the pepper soup was a bit salty but everything else was on point. Good vibes!', critic: 'Suya was okay but overpriced for the portion size. Pepper soup was too salty. Disappointing.', brief_generous: 'Spicy suya, great yaji. Recommended.', brief_critic: 'Overpriced portions. Salty soup.' },
  { item_id: 'bukka_hut_lekki',     generous: 'Bukka Hut always delivers that home-cooked feel. The banga soup with starch was everything. Portions are generous and prices are fair. Abeg keep it up!', critic: 'Banga soup was watery. Portions have shrunk but prices stayed the same. Not impressed.', brief_generous: 'Home-cooked feel, generous portions.', brief_critic: 'Watery soup, small portions.' },
  { item_id: 'kilimanjaro_vi',      generous: 'Great spot for a quick Nigerian meal. The rice dishes are always well-seasoned. Service could be faster but the food quality makes up for it. Solid experience!', critic: 'Rice was bland and service was painfully slow. Better options exist in the area for this price.', brief_generous: 'Well-seasoned rice. Good value.', brief_critic: 'Bland food, slow service.' },
];

export function generatePreviewRecords(answers) {
  const get = (id) => answers.find(a => a.question_id === id)?.answer ?? '';

  const ratingStyle  = get('rating_style');
  const reviewStyle  = get('review_style');
  const nigerianEng  = get('nigerian_english');

  const generous  = ratingStyle === 'top_marks';
  const detailed  = reviewStyle === 'detailed_and_thorough';
  const nigerian  = nigerianEng === 'yes_often';
  const sometimes = nigerianEng === 'sometimes';

  const baseRatings = generous ? [5, 5, 4, 4, 5] : [3, 2, 3, 2, 3];
  const timestamps  = ['2024-01-10', '2024-02-05', '2024-03-14', '2024-04-28', '2024-06-01'];

  return GENEROUS_REVIEWS.map((r, i) => {
    let text = generous
      ? (detailed ? r.generous : r.brief_generous)
      : (detailed ? r.critic   : r.brief_critic);

    // Strip pidgin if user doesn't use Nigerian English
    if (!nigerian && !sometimes) {
      text = text
        .replace(/\bAbeg\b/g, 'Honestly')
        .replace(/\bNa wa o[,!]?\s*/g, '')
        .replace(/\be don do\b/g, 'it delivered')
        .replace(/\bna top tier\b/g, 'is top tier');
    }

    return {
      item_id: r.item_id,
      rating: baseRatings[i],
      review_text: text,
      timestamp: timestamps[i],
      source: 'yelp',
    };
  });
}
