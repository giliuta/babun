Pod::Spec.new do |s|
  s.name           = 'BabunCallerId'
  s.version        = '1.0.0'
  s.summary        = 'Babun caller ID: client numbers for the Call Directory extension'
  s.description    = 'Writes the client number list into the shared App Group container and reloads the Call Directory extension.'
  s.license        = 'UNLICENSED'
  s.author         = 'Babun'
  s.homepage       = 'https://babun.app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CallKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
