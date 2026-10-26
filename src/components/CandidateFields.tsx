type Values = Record<string, string | null | undefined>;

export function CandidateFields({ v = {} }: { v?: Values }) {
  const text = (name: string, label: string, opts: { type?: string; required?: boolean } = {}) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={opts.type ?? "text"} required={opts.required} defaultValue={v[name] ?? ""} className="input" />
    </div>
  );
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        {text("first_name", "First name", { required: true })}
        {text("last_name", "Last name", { required: true })}
        {text("phone", "Phone", { required: true })}
        {text("email", "Email", { type: "email" })}
        {text("id_number", "National ID number")}
        {text("dob", "Date of birth", { type: "date" })}
        <div>
          <label className="label" htmlFor="gender">Gender</label>
          <select id="gender" name="gender" defaultValue={v.gender ?? ""} className="select">
            <option value="">Not stated</option>
            <option>Female</option>
            <option>Male</option>
          </select>
        </div>
        {text("county", "County")}
      </div>
      <div>
        <label className="label" htmlFor="skills">Skills</label>
        <textarea id="skills" name="skills" rows={2} defaultValue={v.skills ?? ""} className="textarea" />
      </div>
      <div>
        <label className="label" htmlFor="experience">Work experience</label>
        <textarea id="experience" name="experience" rows={3} defaultValue={v.experience ?? ""} className="textarea" />
      </div>
      {text("preferred_countries", "Preferred countries")}
    </>
  );
}
