-- Stage descriptions are shown to candidates in their portal, so they are worded for them.
UPDATE pipeline_stages SET description = 'Registration and consent' WHERE description = 'Self sign-up or staff add; consent recorded';
UPDATE pipeline_stages SET description = 'Your profile, ID, skills and experience are checked' WHERE description = 'Recruiter checks profile, ID, skills and experience';
UPDATE pipeline_stages SET description = 'Matched to a job and shown to the employer' WHERE description = 'Matched to a job order and sent to the employer';
UPDATE pipeline_stages SET description = 'The employer interviews and chooses' WHERE description = 'Employer interviews and selects the candidate';
UPDATE pipeline_stages SET description = 'Offer made and contract signed' WHERE description = 'Offer and contract signed; payment model confirmed';
UPDATE pipeline_stages SET description = 'Travelled and started work' WHERE description = 'Worker travels and starts; employer is invoiced';
UPDATE pipeline_stages SET description = 'Check-ins while working abroad, and a way to raise problems' WHERE description = 'Check-ins abroad, complaints channel, case closed';
