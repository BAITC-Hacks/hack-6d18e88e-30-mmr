# Rating

**Owner**: Core Logic Developer

### Responsibilities:
- Task readiness score (0-100) visualization
- Breakdown display (Context: 20, Data: 20, Result: 15, Success: 15, Constraints: 10, Users: 10, Communication: 10)
- Readiness level badges (Draft, Working, Ready, Priority)
- Dynamic improvement recommendations ("What will increase the rating")
- Real-time completeness preview on field edits, explicitly labelled as preliminary
- Awarded rating only for confirmed fields; edits invalidate approval until reconfirmation

### Dependencies:
- `src/types/rating.ts`
- `src/services/ratingService.ts`
