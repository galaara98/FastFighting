/**
 * The GM's review of a deal in a live battle (engine/behavior/deals.js): who offered what to whom, the roll against its
 * DC, what FastFighting makes of it (the target's greed, nerve and loyalty; the offer against its purse; how likely it
 * says no all the same, or is bought over), the player's answer where a player's character was asked, and Approve or
 * Deny. It opens at once on the GM's screen; the GM-only card and the Battle Vantage's deals waiting open it again. The
 * words come worked out (foundry/live-battle.js reviewDeal): this window only shows them and hands back the say.
 */
import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DealReview extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["fast-fighting", "ff-deal-review"],
    window: { title: "FASTFIGHTING.Deal.ReviewTitle", icon: "fa-solid fa-scale-balanced" },
    position: { width: 440, height: "auto" },
    actions: { approve: DealReview.#onApprove, deny: DealReview.#onDeny }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/deal-review.hbs` }
  };

  /**
   * @param {object} review  {id, context: what the window shows, decide(verdict): the GM's say, "approve" or "deny"}
   */
  constructor(review, options = {}) {
    super({ id: `ff-deal-review-${review.id}`, ...options });
    this.review = review;
  }

  async _prepareContext() {
    return this.review.context;
  }

  static #onApprove() {
    this.review.decide("approve");
    this.close();
  }

  static #onDeny() {
    this.review.decide("deny");
    this.close();
  }
}
