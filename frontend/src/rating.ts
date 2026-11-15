// A place's rating is the average of its real reviews (backend
// core/reviews.py), so a place nobody has reviewed yet has rating 0. Showing
// "0.0" reads as the worst possible score; show "New" instead.

type Rated = { rating: number; review_count?: number | null };

export const hasRating = (b: Rated): boolean => (b.review_count ?? 0) > 0;

/** "4.6", or "New" for a place with no reviews yet. */
export const ratingText = (b: Rated): string => (hasRating(b) ? b.rating.toFixed(1) : "New");
