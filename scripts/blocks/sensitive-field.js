  // Whether an element's value must never appear in the overlay, which shows in screenshots. It errs
  // toward masking: credentials, payment fields, one-time codes, bank and government IDs, hidden
  // inputs, and anything marked data-tracker-mask. A field seen once as a password stays masked
  // after a "show password" toggle turns it into text. Ordinary text, email, and phone fields show.
  const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-|one-time-code|current-password|new-password)/i;
  // Matched against whole words of a field's name, id, label, and placeholder: "newPassword" and
  // "user_pin" are sensitive, "passenger", "footprint", and "pinned" are not.
  const SENSITIVE_WORDS =
    /\b(pw|pwd|pass|password|passwd|passcode|passphrase|secret|token|otp|pin|ssn|iban|cvv|cvc|api ?key|private ?key|security ?code|card ?(number|num|no)|cc ?(number|num))\b/;
  const words = (text) =>
    text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase();
  const wasPassword = new WeakSet();
  const secret = (el) => {
    if (!el || !el.getAttribute) return false;
    const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (!field) return false;
    if (el.type === 'password') wasPassword.add(el);
    if (wasPassword.has(el) || el.type === 'hidden' || el.hasAttribute('data-tracker-mask')) return true;
    if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) return true;
    const names = [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder')];
    return SENSITIVE_WORDS.test(words(names.filter(Boolean).join(' ')));
  };
  // A masked value: the same mark whatever its length, so the overlay reveals nothing about it.
  const MASK = '•••';
